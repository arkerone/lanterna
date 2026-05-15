import type {
  BuiltinFinding,
  EventLoopReport,
  Finding,
  FindingRemediation,
  Hotspot,
  SyncCryptoEvidenceExtra,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, SYNC_CRYPTO_FNS, SYNC_CRYPTO_PATTERNS } from '../config.js';

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

import type { KindScopedDetector } from '@lanterna-profiler/core';
import {
  aggregateByPatterns,
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  exceedsCategoryThreshold,
  findStallCorrelation,
  isBuiltinRuntimeHotspot,
  readFrameSourceText,
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
      findings.push(
        buildFinding(hotspot, categoryTotalPct, report, context, cpu.view.bundle.target.cwd),
      );
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  categoryTotalPct: number,
  report: { eventLoop: EventLoopReport },
  context: CpuHotspotContext,
  cwd: string,
): BuiltinFinding<'sync-crypto'> {
  const { attribution, caller, candidateCallers } = resolveAttribution(hotspot, context);
  const sourceCallsiteCaller =
    findSourceCallsiteCaller(candidateCallers, hotspot.function, cwd) ?? caller;
  const evidenceExtra: SyncCryptoEvidenceExtra = {
    callee: hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(attribution, caller, candidateCallers),
    eventLoopCorrelation: findStallCorrelation(caller ?? attribution, report),
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
      caller: sourceCallsiteCaller,
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

function findSourceCallsiteCaller(
  candidates: readonly UserCallerAttribution[],
  callee: string,
  cwd: string,
): UserCallerAttribution | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(callExpressionName(callee))}\\s*\\(`);
  for (const candidate of candidates) {
    const source = readFrameSourceText(candidate, cwd);
    const anchorLine = candidate.source?.line ?? candidate.line;
    const line =
      findPatternLineNearAnchor(source, anchorLine, pattern) ??
      findPatternLineInFunctionBlock(source, anchorLine, pattern);
    if (line !== undefined) {
      return {
        ...candidate,
        line,
        ...(candidate.source ? { source: { ...candidate.source, line } } : {}),
      };
    }
  }
  return undefined;
}

function callExpressionName(callee: string): string {
  const normalized = stripOptPrefix(callee);
  return normalized.split('.').at(-1) ?? normalized;
}

function findPatternLineNearAnchor(
  sourceText: string | undefined,
  line: number,
  pattern: RegExp,
  radius = 2,
): number | undefined {
  if (!sourceText || line <= 0) return undefined;
  const lines = sourceText.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) return undefined;
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  for (let current = start; current < end; current += 1) {
    if (pattern.test(lines[current] ?? '')) return current + 1;
  }
  return undefined;
}

function findPatternLineInFunctionBlock(
  sourceText: string | undefined,
  line: number,
  pattern: RegExp,
): number | undefined {
  if (!sourceText || line <= 0) return undefined;
  const lines = sourceText.split(/\r?\n/);
  let depth = 0;
  let enteredBlock = false;
  for (let current = line - 1; current < lines.length; current += 1) {
    const text = lines[current] ?? '';
    if (enteredBlock && pattern.test(text)) return current + 1;
    for (const char of text) {
      if (char === '{') {
        depth += 1;
        enteredBlock = true;
      } else if (char === '}') {
        depth -= 1;
        if (enteredBlock && depth <= 0) return undefined;
      }
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
