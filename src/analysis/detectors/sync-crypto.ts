import type {
  BuiltinFinding,
  Finding,
  Hotspot,
  LanternaReport,
  SyncCryptoEvidenceExtra,
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

const SYNC_CRYPTO_FNS = [
  'pbkdf2Sync',
  'scryptSync',
  'randomBytesSync',
];

export const syncCryptoDetector: Detector = {
  id: 'sync-crypto-on-hot-path',
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.syncCrypto;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      if (!SYNC_CRYPTO_FNS.some((functionName) => (
        normalizedFunctionName === functionName
        || normalizedFunctionName.endsWith(`.${functionName}`)
      ))) {
        continue;
      }
      if (hotspot.totalPct < thresholds.minTotalPct) continue;
      findings.push(buildFinding(hotspot, report, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  report: LanternaReport,
  context: FindingContext,
): BuiltinFinding<'sync-crypto'> {
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: SyncCryptoEvidenceExtra = {
    callee: hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
  };
  return defineBuiltinFinding(buildBlockingFinding({
    id: 'sync-crypto-on-hot-path',
    category: 'sync-crypto',
    severity: hotspot.totalPct > DETECTOR_THRESHOLDS.syncCrypto.criticalPct ? 'critical' : 'warning',
    title: `Synchronous crypto on hot path (${hotspot.function})`,
    hotspot,
    caller,
    selfPct: hotspot.totalPct,
    extra: evidenceExtra,
    why: `\`${hotspot.function}\` is a synchronous crypto primitive that blocks the event loop for the duration of the computation. On a server it pauses all other requests.`,
    suggestion: `Switch to the async variant (e.g. \`crypto.pbkdf2\` / \`crypto.scrypt\` with a callback or promisified) and/or offload to a worker pool (piscina). For PBKDF2/scrypt which are CPU-bound by design, worker_threads is the right answer above a few hundred reqs/s.`,
    references: [
      'https://nodejs.org/api/crypto.html#cryptopbkdf2password-salt-iterations-keylen-digest-callback',
      'https://github.com/piscinajs/piscina',
    ],
  }));
}
