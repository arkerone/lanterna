import type {
  BuiltinFinding,
  EventLoopReport,
  Finding,
  FindingRemediation,
  Hotspot,
  SyncCryptoEvidenceExtra,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, SYNC_CRYPTO_FNS, SYNC_CRYPTO_PATTERNS } from '../config.js';

const SYNC_CRYPTO_REMEDIATION: ReadonlyMap<string, FindingRemediation> = new Map([
  [
    'pbkdf2Sync',
    {
      kind: 'async-variant',
      replace: 'pbkdf2Sync',
      with: 'promisify(pbkdf2)',
      module: 'node:crypto',
      notes:
        'PBKDF2 is CPU-bound — at high load also consider offloading to a worker pool (piscina).',
    },
  ],
  [
    'scryptSync',
    {
      kind: 'async-variant',
      replace: 'scryptSync',
      with: 'promisify(scrypt)',
      module: 'node:crypto',
      notes:
        'scrypt is CPU-bound — at high load also consider offloading to a worker pool (piscina).',
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

import type { KindScopedDetector } from '@lanterna-profiler/core';
import {
  aggregateByPatterns,
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  exceedsCategoryThreshold,
  findStallCorrelation,
  isBuiltinRuntimeHotspot,
  resolveAttribution,
  severityForPct,
} from './shared.js';

export const syncCryptoDetector: KindScopedDetector<'cpu'> = {
  id: 'sync-crypto-on-hot-path',
  kindIds: ['cpu'],
  detect({ cpu }): Finding[] {
    const report = cpu.report;
    const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
    const thresholds = DETECTOR_THRESHOLDS.syncCrypto;
    const { categoryTotalPct } = aggregateByPatterns(context.fullHotspots, SYNC_CRYPTO_PATTERNS, {
      normalize: stripOptPrefix,
    });
    const familyExceeded = exceedsCategoryThreshold(categoryTotalPct, thresholds.categoryTotalPct);
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      if (!isBuiltinRuntimeHotspot(hotspot)) continue;
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      if (
        !SYNC_CRYPTO_FNS.some(
          (functionName) =>
            normalizedFunctionName === functionName ||
            normalizedFunctionName.endsWith(`.${functionName}`),
        )
      ) {
        continue;
      }
      if (hotspot.totalPct < thresholds.minTotalPct && !familyExceeded) continue;
      findings.push(buildFinding(hotspot, categoryTotalPct, report, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  categoryTotalPct: number,
  report: { eventLoop: EventLoopReport },
  context: CpuHotspotContext,
): BuiltinFinding<'sync-crypto'> {
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: SyncCryptoEvidenceExtra = {
    callee: hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
    categoryTotalPct: categoryTotalPct > 0 ? categoryTotalPct : undefined,
  };
  const thresholds = DETECTOR_THRESHOLDS.syncCrypto;
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: 'sync-crypto-on-hot-path',
      category: 'sync-crypto',
      severity: severityForPct(hotspot.totalPct, thresholds.criticalPct),
      title: `Synchronous crypto on hot path (${hotspot.function})`,
      hotspot,
      caller,
      selfPct: hotspot.totalPct,
      extra: evidenceExtra,
      measurements: {
        observed: {
          selfPct: hotspot.selfPct,
          totalPct: hotspot.totalPct,
          categoryTotalPct,
        },
        thresholds: {
          minTotalPct: thresholds.minTotalPct,
          criticalPct: thresholds.criticalPct,
          categoryTotalPct: thresholds.categoryTotalPct,
        },
      },
      remediation: remediationForFunction(hotspot.function),
      why: `\`${hotspot.function}\` is a synchronous crypto primitive that blocks the event loop for the duration of the computation. On a server it pauses all other requests.`,
      suggestion: `Switch to the async variant (e.g. \`crypto.pbkdf2\` / \`crypto.scrypt\` with a callback or promisified) and/or offload to a worker pool (piscina). For PBKDF2/scrypt which are CPU-bound by design, worker_threads is the right answer above a few hundred reqs/s.`,
      references: [
        'https://nodejs.org/api/crypto.html#cryptopbkdf2password-salt-iterations-keylen-digest-callback',
        'https://github.com/piscinajs/piscina',
      ],
    }),
  );
}
