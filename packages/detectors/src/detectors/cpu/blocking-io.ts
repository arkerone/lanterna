import type { FindingRemediation, Hotspot } from '@lanterna-profiler/core';
import { stripOptPrefix } from '@lanterna-profiler/core';
import { BLOCKING_IO_PATTERNS, DETECTOR_THRESHOLDS } from '../../config.js';
import { defineAttributedHotspotDetector } from '../shared/attributed-finding.js';
import {
  type CpuHotspotContext,
  exceedsAnyHotspotThreshold,
  isBuiltinRuntimeHotspot,
  maxHotspotPct,
  readFrameSourceText,
  severityForPct,
  sourceCallPatternForApi,
} from '../shared/attribution.js';

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

const ZLIB_PROCESS_CHUNK_SYNC = 'processChunkSync';
const ZLIB_SYNC_APIS = ['gzipSync', 'gunzipSync', 'deflateSync', 'inflateSync'] as const;

const thresholds = DETECTOR_THRESHOLDS.blockingIo;

interface BlockingIoMatch {
  readonly api: string;
  readonly callee: string | undefined;
}

export const blockingIoDetector = defineAttributedHotspotDetector<'blocking-io', BlockingIoMatch>({
  id: 'blocking-io',
  category: 'blocking-io',
  family: {
    patterns: BLOCKING_IO_PATTERNS,
    normalize: stripOptPrefix,
    extraTotal: (context) =>
      context.fullHotspots
        .filter(isZlibProcessChunkSyncHotspot)
        .reduce((sum, hotspot) => sum + hotspot.totalPct, 0),
    threshold: thresholds.categoryTotalPct,
  },
  match(hotspot, ctx) {
    if (!isBuiltinRuntimeHotspot(hotspot)) return undefined;
    const normalizedFunctionName = stripOptPrefix(hotspot.function);
    const patternMatch =
      BLOCKING_IO_PATTERNS.find((pattern) => pattern.re.test(normalizedFunctionName)) ??
      zlibProcessChunkPattern(hotspot, ctx.context, ctx.cwd);
    if (!patternMatch) return undefined;
    const perFrameHit = exceedsAnyHotspotThreshold(hotspot, thresholds);
    if (!perFrameHit && !ctx.familyExceeded) return undefined;
    const callee = 'callee' in patternMatch ? patternMatch.callee : undefined;
    return { api: patternMatch.api, callee };
  },
  severity: (_match, hotspot) => severityForPct(maxHotspotPct(hotspot), thresholds.criticalPct),
  selfPct: (_match, hotspot) => maxHotspotPct(hotspot),
  sourcePattern: (match) => sourceCallPatternForApi(match.api),
  describe: (match) => {
    const asyncApi = match.api.replace(/Sync$/, '');
    const remediation = BLOCKING_IO_REMEDIATION.get(match.api);
    return {
      id: `blocking-io:${match.api}`,
      title: `Blocking I/O call on hot path (${match.api})`,
      why: `\`${match.api}\` is synchronous and blocks the event loop until the I/O completes. In a server this stalls every concurrent request.`,
      suggestion: `Use the async variant: \`${asyncApi}\` (promises: \`fs/promises\`, \`util.promisify\`, \`node:child_process\` \`execFile\`/\`spawn\` with streams). If you need CPU-bound work, move it to a worker thread.`,
      references: [
        'https://nodejs.org/api/fs.html#promises-api',
        'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
      ],
      ...(remediation ? { remediation } : {}),
    };
  },
  measurements: (_match, hotspot, ctx) => ({
    observed: {
      selfPct: hotspot.selfPct,
      totalPct: hotspot.totalPct,
      categoryTotalPct: ctx.categoryTotalPct,
    },
    thresholds: {
      minSelfPct: thresholds.minSelfPct,
      minTotalPct: thresholds.minTotalPct,
      criticalPct: thresholds.criticalPct,
      categoryTotalPct: thresholds.categoryTotalPct,
    },
  }),
  extra: (match, hotspot, parts, ctx) => ({
    api: match.api,
    callee: match.callee ?? hotspot.function,
    ...parts.attributionEvidence,
    eventLoopCorrelation: parts.eventLoopCorrelation,
    categoryTotalPct: ctx.categoryTotalPct > 0 ? ctx.categoryTotalPct : undefined,
  }),
});

function isZlibProcessChunkSyncHotspot(hotspot: Hotspot): boolean {
  return (
    stripOptPrefix(hotspot.function) === ZLIB_PROCESS_CHUNK_SYNC &&
    (hotspot.file === 'node:zlib' || hotspot.file.endsWith('/zlib.js'))
  );
}

function zlibProcessChunkPattern(
  hotspot: Hotspot,
  context: CpuHotspotContext,
  cwd: string,
): { api: string; callee?: string } | undefined {
  if (!isZlibProcessChunkSyncHotspot(hotspot)) return undefined;
  return {
    api: inferZlibSyncApi(hotspot, context, cwd),
    callee: 'node:zlib processChunkSync',
  };
}

function inferZlibSyncApi(hotspot: Hotspot, context: CpuHotspotContext, cwd: string): string {
  const attribution = context.userCallerById.get(hotspot.id);
  const candidates = [attribution, ...(context.candidateCallersById?.get(hotspot.id) ?? [])].filter(
    (candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate),
  );
  for (const candidate of candidates) {
    const source = readFrameSourceText(candidate, cwd);
    const match = source?.match(/\b(gzipSync|gunzipSync|deflateSync|inflateSync)\s*\(/);
    if (match?.[1] && ZLIB_SYNC_APIS.includes(match[1] as (typeof ZLIB_SYNC_APIS)[number])) {
      return `zlib.${match[1]}`;
    }
  }
  return 'zlib.gzipSync';
}
