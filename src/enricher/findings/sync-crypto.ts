import type { Finding, Hotspot, LanternaReport } from '../../report/types.js';
import type { Detector, FindingContext } from './types.js';

const SYNC_CRYPTO_FNS = [
  'pbkdf2Sync',
  'scryptSync',
  'randomBytesSync',
];

export const syncCryptoDetector: Detector = {
  id: 'sync-crypto-on-hot-path',
  detect(report, context): Finding[] {
    const findings: Finding[] = [];
    for (const h of context.fullHotspots) {
      const fnName = stripOptPrefix(h.function);
      if (!SYNC_CRYPTO_FNS.some((s) => fnName === s || fnName.endsWith(`.${s}`))) continue;
      // Use totalPct: the actual CPU ends up in native children (C++ work), not the JS wrapper self.
      if (h.totalPct < 1) continue;
      findings.push(buildFinding(h, report, context));
    }
    return findings;
  },
};

function buildFinding(h: Hotspot, report: LanternaReport, context: FindingContext): Finding {
  const attribution = context.userAttributionById.get(h.id);
  const caller = attribution?.confidence === 'high' ? attribution : undefined;
  const stallCorrelation = findStallCorrelation(caller, report);
  return {
    id: 'sync-crypto-on-hot-path',
    severity: h.totalPct > 10 ? 'critical' : 'warning',
    category: 'sync-crypto',
    title: `Synchronous crypto on hot path (${h.function})`,
    evidence: {
      file: caller?.file ?? h.file,
      line: caller?.line ?? h.line,
      function: caller?.function ?? h.function,
      selfPct: h.totalPct,
      extra: {
        callee: h.function,
        calleeTotalPct: h.totalPct,
        attributionBasis: caller ? 'sample-path' : 'builtin-only',
        attributionConfidence: caller?.confidence ?? 'low',
        userAttribution: attribution,
        eventLoopCorrelation: stallCorrelation,
      },
    },
    why: `\`${h.function}\` is a synchronous crypto primitive that blocks the event loop for the duration of the computation. On a server it pauses all other requests.`,
    suggestion: `Switch to the async variant (e.g. \`crypto.pbkdf2\` / \`crypto.scrypt\` with a callback or promisified) and/or offload to a worker pool (piscina). For PBKDF2/scrypt which are CPU-bound by design, worker_threads is the right answer above a few hundred reqs/s.`,
    references: [
      'https://nodejs.org/api/crypto.html#cryptopbkdf2password-salt-iterations-keylen-digest-callback',
      'https://github.com/piscinajs/piscina',
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
