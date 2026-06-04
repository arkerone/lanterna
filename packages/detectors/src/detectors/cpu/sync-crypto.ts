import type { FindingRemediation } from '@lanterna-profiler/core';
import { stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, SYNC_CRYPTO_FNS, SYNC_CRYPTO_PATTERNS } from '../../config.js';
import { defineAttributedHotspotDetector } from '../shared/attributed-finding.js';
import {
  isBuiltinRuntimeHotspot,
  severityForPct,
  sourceCallPatternForApi,
} from '../shared/attribution.js';

const SYNC_CRYPTO_REMEDIATION: ReadonlyMap<string, FindingRemediation> = new Map([
  [
    'pbkdf2Sync',
    {
      kind: 'async-variant',
      replace: 'pbkdf2Sync',
      with: 'pbkdf2',
      module: 'node:crypto',
      notes:
        'crypto.pbkdf2 is callback-based async; use util.promisify(pbkdf2) if the caller wants a Promise. PBKDF2 is CPU-bound — at high load also consider offloading to a worker pool (piscina).',
    },
  ],
  [
    'scryptSync',
    {
      kind: 'async-variant',
      replace: 'scryptSync',
      with: 'scrypt',
      module: 'node:crypto',
      notes:
        'crypto.scrypt is callback-based async; use util.promisify(scrypt) if the caller wants a Promise. scrypt is CPU-bound — at high load also consider offloading to a worker pool (piscina).',
    },
  ],
  [
    'randomBytesSync',
    {
      kind: 'async-variant',
      replace: 'randomBytes(size)',
      with: 'promisify(randomBytes)(size)',
      module: 'node:crypto',
    },
  ],
]);

function remediationForFunction(fn: string): FindingRemediation | undefined {
  const normalized = stripOptPrefix(fn);
  for (const key of SYNC_CRYPTO_REMEDIATION.keys()) {
    if (normalized === key || normalized.endsWith(`.${key}`)) {
      return SYNC_CRYPTO_REMEDIATION.get(key);
    }
  }
  return undefined;
}

const thresholds = DETECTOR_THRESHOLDS.syncCrypto;

interface SyncCryptoMatch {
  readonly callee: string;
}

export const syncCryptoDetector = defineAttributedHotspotDetector<'sync-crypto', SyncCryptoMatch>({
  id: 'sync-crypto-on-hot-path',
  category: 'sync-crypto',
  family: {
    patterns: SYNC_CRYPTO_PATTERNS,
    normalize: stripOptPrefix,
    threshold: thresholds.categoryTotalPct,
  },
  match(hotspot, ctx) {
    if (!isBuiltinRuntimeHotspot(hotspot)) return undefined;
    const normalizedFunctionName = stripOptPrefix(hotspot.function);
    const isSyncCrypto = SYNC_CRYPTO_FNS.some(
      (functionName) =>
        normalizedFunctionName === functionName ||
        normalizedFunctionName.endsWith(`.${functionName}`),
    );
    if (!isSyncCrypto) return undefined;
    if (hotspot.totalPct < thresholds.minTotalPct && !ctx.familyExceeded) return undefined;
    return { callee: hotspot.function };
  },
  severity: (_match, hotspot) => severityForPct(hotspot.totalPct, thresholds.criticalPct),
  selfPct: (_match, hotspot) => hotspot.totalPct,
  sourcePattern: (_match, hotspot) => sourceCallPatternForApi(stripOptPrefix(hotspot.function)),
  describe: (match, hotspot) => {
    const remediation = remediationForFunction(match.callee);
    return {
      id: 'sync-crypto-on-hot-path',
      title: `Synchronous crypto on hot path (${hotspot.function})`,
      why: `\`${hotspot.function}\` is a synchronous crypto primitive that blocks the event loop for the duration of the computation. On a server it pauses all other requests.`,
      suggestion: `Switch to the async variant (e.g. \`crypto.pbkdf2\` / \`crypto.scrypt\` with a callback or promisified) and/or offload to a worker pool (piscina). For PBKDF2/scrypt which are CPU-bound by design, worker_threads is the right answer above a few hundred reqs/s.`,
      references: [
        'https://nodejs.org/api/crypto.html#cryptopbkdf2password-salt-iterations-keylen-digest-callback',
        'https://github.com/piscinajs/piscina',
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
      minTotalPct: thresholds.minTotalPct,
      criticalPct: thresholds.criticalPct,
      categoryTotalPct: thresholds.categoryTotalPct,
    },
  }),
  extra: (_match, hotspot, parts, ctx) => ({
    callee: hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...parts.attributionEvidence,
    eventLoopCorrelation: parts.eventLoopCorrelation,
    categoryTotalPct: ctx.categoryTotalPct > 0 ? ctx.categoryTotalPct : undefined,
  }),
});
