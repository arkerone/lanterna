import type {
  BlockingIoEvidenceExtra,
  BuiltinFinding,
  Finding,
  Hotspot,
  LanternaReport,
} from '../../report/types.js';
import { defineBuiltinFinding } from '../../report/types.js';
import type { Detector, FindingContext } from './types.js';
import {
  buildAttributionEvidence,
  buildBlockingFinding,
  findStallCorrelation,
  resolveAttribution,
} from './shared.js';
import { stripOptPrefix } from '../../shared/frame.js';
import { DETECTOR_THRESHOLDS } from '../../shared/config.js';

const BLOCKING_PATTERNS: Array<{ re: RegExp; api: string }> = [
  { re: /(^|\.)readFileSync$/, api: 'fs.readFileSync' },
  { re: /(^|\.)writeFileSync$/, api: 'fs.writeFileSync' },
  { re: /(^|\.)statSync$/, api: 'fs.statSync' },
  { re: /(^|\.)existsSync$/, api: 'fs.existsSync' },
  { re: /(^|\.)readdirSync$/, api: 'fs.readdirSync' },
  { re: /(^|\.)execSync$/, api: 'child_process.execSync' },
  { re: /(^|\.)execFileSync$/, api: 'child_process.execFileSync' },
  { re: /(^|\.)spawnSync$/, api: 'child_process.spawnSync' },
  { re: /(^|\.)gzipSync$/, api: 'zlib.gzipSync' },
  { re: /(^|\.)gunzipSync$/, api: 'zlib.gunzipSync' },
  { re: /(^|\.)deflateSync$/, api: 'zlib.deflateSync' },
  { re: /(^|\.)inflateSync$/, api: 'zlib.inflateSync' },
];

export const blockingIoDetector: Detector = {
  id: 'blocking-io',
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.blockingIo;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      const patternMatch = BLOCKING_PATTERNS.find((pattern) => pattern.re.test(normalizedFunctionName));
      if (!patternMatch) continue;
      if (hotspot.selfPct < thresholds.minSelfPct && hotspot.totalPct < thresholds.minTotalPct) continue;
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
  return defineBuiltinFinding(buildBlockingFinding({
    id: `blocking-io:${api}`,
    category: 'blocking-io',
    severity: Math.max(hotspot.selfPct, hotspot.totalPct) > DETECTOR_THRESHOLDS.blockingIo.criticalPct ? 'critical' : 'warning',
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
  }));
}
