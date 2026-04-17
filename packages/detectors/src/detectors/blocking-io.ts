import type {
  BlockingIoEvidenceExtra,
  BuiltinFinding,
  Finding,
  Hotspot,
  LanternaReport,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { BLOCKING_IO_PATTERNS, DETECTOR_THRESHOLDS } from '../config.js';
import {
  buildAttributedFinding,
  buildAttributionEvidence,
  findStallCorrelation,
  resolveAttribution,
} from './shared.js';
import type { Detector, FindingContext } from './types.js';

export const blockingIoDetector: Detector = {
  id: 'blocking-io',
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.blockingIo;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'native') continue;
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      const patternMatch = BLOCKING_IO_PATTERNS.find((pattern) =>
        pattern.re.test(normalizedFunctionName),
      );
      if (!patternMatch) continue;
      if (hotspot.selfPct < thresholds.minSelfPct && hotspot.totalPct < thresholds.minTotalPct)
        continue;
      findings.push(buildFinding(hotspot, patternMatch.api, report, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  api: string,
  report: LanternaReport,
  context: FindingContext,
): BuiltinFinding<'blocking-io'> {
  const asyncApi = api.replace(/Sync$/, '');
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: BlockingIoEvidenceExtra = {
    api,
    callee: hotspot.function,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
  };
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: `blocking-io:${api}`,
      category: 'blocking-io',
      severity:
        Math.max(hotspot.selfPct, hotspot.totalPct) > DETECTOR_THRESHOLDS.blockingIo.criticalPct
          ? 'critical'
          : 'warning',
      title: `Blocking I/O call on hot path (${api})`,
      hotspot,
      caller,
      selfPct: Math.max(hotspot.selfPct, hotspot.totalPct),
      extra: evidenceExtra,
      why: `\`${api}\` is synchronous and blocks the event loop until the I/O completes. In a server this stalls every concurrent request.`,
      suggestion: `Use the async variant: \`${asyncApi}\` (promises: \`fs/promises\`, \`util.promisify\`, \`node:child_process\` \`execFile\`/\`spawn\` with streams). If you need CPU-bound work, move it to a worker thread.`,
      references: [
        'https://nodejs.org/api/fs.html#promises-api',
        'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
      ],
    }),
  );
}
