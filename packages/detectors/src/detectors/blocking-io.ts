import type {
  BlockingIoEvidenceExtra,
  BuiltinFinding,
  EventLoopReport,
  Finding,
  FindingRemediation,
  Hotspot,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { BLOCKING_IO_PATTERNS, DETECTOR_THRESHOLDS } from '../config.js';

/** Per-API async replacement used to build structured remediation. */
const BLOCKING_IO_REMEDIATION: ReadonlyMap<string, FindingRemediation> = new Map([
  [
    'fs.readFileSync',
    {
      kind: 'async-variant',
      replace: 'fs.readFileSync',
      with: 'readFile',
      module: 'node:fs/promises',
    },
  ],
  [
    'fs.writeFileSync',
    {
      kind: 'async-variant',
      replace: 'fs.writeFileSync',
      with: 'writeFile',
      module: 'node:fs/promises',
    },
  ],
  [
    'fs.statSync',
    { kind: 'async-variant', replace: 'fs.statSync', with: 'stat', module: 'node:fs/promises' },
  ],
  [
    'fs.existsSync',
    {
      kind: 'async-variant',
      replace: 'fs.existsSync',
      with: 'access',
      module: 'node:fs/promises',
      notes:
        'existsSync has no direct async equivalent — call fsPromises.access() and catch ENOENT.',
    },
  ],
  [
    'fs.readdirSync',
    {
      kind: 'async-variant',
      replace: 'fs.readdirSync',
      with: 'readdir',
      module: 'node:fs/promises',
    },
  ],
  [
    'child_process.execSync',
    {
      kind: 'async-variant',
      replace: 'execSync',
      with: 'promisify(exec)',
      module: 'node:child_process',
    },
  ],
  [
    'child_process.execFileSync',
    {
      kind: 'async-variant',
      replace: 'execFileSync',
      with: 'promisify(execFile)',
      module: 'node:child_process',
    },
  ],
  [
    'child_process.spawnSync',
    {
      kind: 'async-variant',
      replace: 'spawnSync',
      with: 'spawn',
      module: 'node:child_process',
      notes: 'spawn() returns a ChildProcess; consume stdio streams instead of waiting on .output.',
    },
  ],
  [
    'zlib.gzipSync',
    { kind: 'async-variant', replace: 'gzipSync', with: 'promisify(gzip)', module: 'node:zlib' },
  ],
  [
    'zlib.gunzipSync',
    {
      kind: 'async-variant',
      replace: 'gunzipSync',
      with: 'promisify(gunzip)',
      module: 'node:zlib',
    },
  ],
  [
    'zlib.deflateSync',
    {
      kind: 'async-variant',
      replace: 'deflateSync',
      with: 'promisify(deflate)',
      module: 'node:zlib',
    },
  ],
  [
    'zlib.inflateSync',
    {
      kind: 'async-variant',
      replace: 'inflateSync',
      with: 'promisify(inflate)',
      module: 'node:zlib',
    },
  ],
]);

import type { CpuHotspotContext } from './shared.js';
import {
  aggregateByPatterns,
  buildAttributedFinding,
  buildAttributionEvidence,
  findStallCorrelation,
  resolveAttribution,
} from './shared.js';

export const blockingIoDetector: KindScopedDetector<'cpu'> = {
  id: 'blocking-io',
  kindIds: ['cpu'],
  detect({ cpu }): Finding[] {
    const report = cpu.report;
    const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
    const thresholds = DETECTOR_THRESHOLDS.blockingIo;
    const { categoryTotalPct } = aggregateByPatterns(context.fullHotspots, BLOCKING_IO_PATTERNS, {
      normalize: stripOptPrefix,
    });
    const familyExceeded = categoryTotalPct >= thresholds.categoryTotalPct;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'native') continue;
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      const patternMatch = BLOCKING_IO_PATTERNS.find((pattern) =>
        pattern.re.test(normalizedFunctionName),
      );
      if (!patternMatch) continue;
      const perFrameHit =
        hotspot.selfPct >= thresholds.minSelfPct || hotspot.totalPct >= thresholds.minTotalPct;
      if (!perFrameHit && !familyExceeded) continue;
      findings.push(buildFinding(hotspot, patternMatch.api, categoryTotalPct, report, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  api: string,
  categoryTotalPct: number,
  report: { eventLoop: EventLoopReport },
  context: CpuHotspotContext,
): BuiltinFinding<'blocking-io'> {
  const asyncApi = api.replace(/Sync$/, '');
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: BlockingIoEvidenceExtra = {
    api,
    callee: hotspot.function,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
    categoryTotalPct: categoryTotalPct > 0 ? categoryTotalPct : undefined,
  };
  const thresholds = DETECTOR_THRESHOLDS.blockingIo;
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: `blocking-io:${api}`,
      category: 'blocking-io',
      severity:
        Math.max(hotspot.selfPct, hotspot.totalPct) > thresholds.criticalPct
          ? 'critical'
          : 'warning',
      title: `Blocking I/O call on hot path (${api})`,
      hotspot,
      caller,
      selfPct: Math.max(hotspot.selfPct, hotspot.totalPct),
      extra: evidenceExtra,
      measurements: {
        observed: {
          selfPct: hotspot.selfPct,
          totalPct: hotspot.totalPct,
          categoryTotalPct,
        },
        thresholds: {
          minSelfPct: thresholds.minSelfPct,
          minTotalPct: thresholds.minTotalPct,
          criticalPct: thresholds.criticalPct,
          categoryTotalPct: thresholds.categoryTotalPct,
        },
      },
      remediation: BLOCKING_IO_REMEDIATION.get(api),
      why: `\`${api}\` is synchronous and blocks the event loop until the I/O completes. In a server this stalls every concurrent request.`,
      suggestion: `Use the async variant: \`${asyncApi}\` (promises: \`fs/promises\`, \`util.promisify\`, \`node:child_process\` \`execFile\`/\`spawn\` with streams). If you need CPU-bound work, move it to a worker thread.`,
      references: [
        'https://nodejs.org/api/fs.html#promises-api',
        'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
      ],
    }),
  );
}
