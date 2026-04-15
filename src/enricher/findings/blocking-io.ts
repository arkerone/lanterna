import type { Finding, Hotspot, LanternaReport } from '../../report/types.js';
import type { Detector, FindingContext } from './types.js';

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
    const findings: Finding[] = [];
    for (const h of context.fullHotspots) {
      const fn = stripOptPrefix(h.function);
      const match = BLOCKING_PATTERNS.find((p) => p.re.test(fn));
      if (!match) continue;
      // Sync blocking calls do CPU in native children; check totalPct, not just selfPct.
      if (h.selfPct < 0.5 && h.totalPct < 1) continue;
      findings.push(buildFinding(h, match.api, report, context));
    }
    return findings;
  },
};

function buildFinding(
  h: Hotspot,
  api: string,
  report: LanternaReport,
  context: FindingContext,
): Finding {
  const asyncApi = api.replace(/Sync$/, '');
  const attribution = context.userAttributionById.get(h.id);
  const caller = attribution?.confidence === 'high' ? attribution : undefined;
  const stallCorrelation = findStallCorrelation(caller, report);
  return {
    id: `blocking-io:${api}`,
    severity: Math.max(h.selfPct, h.totalPct) > 10 ? 'critical' : 'warning',
    category: 'blocking-io',
    title: `Blocking I/O call on hot path (${api})`,
    evidence: {
      file: caller?.file ?? h.file,
      line: caller?.line ?? h.line,
      function: caller?.function ?? h.function,
      selfPct: Math.max(h.selfPct, h.totalPct),
      extra: {
        api,
        callee: h.function,
        attributionBasis: caller ? 'sample-path' : 'builtin-only',
        attributionConfidence: caller?.confidence ?? 'low',
        userAttribution: attribution,
        eventLoopCorrelation: stallCorrelation,
      },
    },
    why: `\`${api}\` is synchronous and blocks the event loop until the I/O completes. In a server this stalls every concurrent request.`,
    suggestion: `Use the async variant: \`${asyncApi}\` (promises: \`fs/promises\`, \`util.promisify\`, \`node:child_process\` \`execFile\`/\`spawn\` with streams). If you need CPU-bound work, move it to a worker thread.`,
    references: [
      'https://nodejs.org/api/fs.html#promises-api',
      'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
    ],
  };
}

function stripOptPrefix(name: string): string {
  return name.replace(/^[*~]/, '');
}

function findStallCorrelation(
  hotspot: { file: string; line: number; function: string } | undefined,
  report: LanternaReport,
): { overlapPct: number; samplePct: number } | undefined {
  if (!hotspot) return undefined;
  const match = report.eventLoop.correlatedHotspots?.find((candidate) =>
    candidate.file === hotspot.file
    && candidate.line === hotspot.line
    && candidate.function === hotspot.function,
  );
  if (!match) return undefined;
  return { overlapPct: match.overlapPct, samplePct: match.samplePct };
}
