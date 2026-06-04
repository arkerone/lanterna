import type { AsyncProfileReport } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import {
  type AsyncListOutcome,
  collectAsyncListFindings,
  confidenceForAsyncFinding,
  emitAsyncFinding,
  hasAsyncRecordLoss,
  skipAsyncItem,
  stopAsyncList,
} from '../../../src/detectors/shared/async-finding.js';

describe('async finding spine', () => {
  it('centralizes record-loss confidence downgrade', () => {
    const report = asyncReport({ recordsDropped: 1 });

    expect(hasAsyncRecordLoss(report)).toBe(true);
    expect(confidenceForAsyncFinding(report, { base: 'high' })).toBe('low');
  });
});

describe('collectAsyncListFindings', () => {
  const report = asyncReport({ recordsDropped: 0 });

  function emit(n: number): AsyncListOutcome {
    return emitAsyncFinding({
      report,
      anchor: {},
      id: `n:${n}`,
      severity: 'warning',
      category: 'test',
      title: `n=${n}`,
      confidence: 'high',
      proofLevel: 'direct-sample',
      extra: {},
      why: 'why',
      suggestion: 'suggestion',
      references: [],
    });
  }

  it('caps the emitted findings at maxFindings', () => {
    const findings = collectAsyncListFindings([1, 2, 3, 4, 5], 3, emit);
    expect(findings.map((f) => f.id)).toEqual(['n:1', 'n:2', 'n:3']);
  });

  it('skips an item but keeps scanning the rest', () => {
    const findings = collectAsyncListFindings([1, 2, 3, 4], 10, (n) =>
      n % 2 === 0 ? skipAsyncItem : emit(n),
    );
    expect(findings.map((f) => f.id)).toEqual(['n:1', 'n:3']);
  });

  it('stops scanning at the first stop, leaving the rest unemitted', () => {
    const findings = collectAsyncListFindings([1, 2, 3, 4], 10, (n) =>
      n >= 3 ? stopAsyncList : emit(n),
    );
    expect(findings.map((f) => f.id)).toEqual(['n:1', 'n:2']);
  });
});

function asyncReport(input: { recordsDropped: number }): AsyncProfileReport {
  return {
    summary: {
      available: true,
      collectedVia: 'async-hooks',
      totalOperations: 0,
      byKind: {},
      orphanCount: 0,
      recordsDropped: input.recordsDropped,
    },
    quality: {
      confidence: 'high',
      instrumentationMode: 'safe',
      attachPartialCapture: false,
      operationCount: 0,
      sampledStackRatio: 1,
      initStackCoverageRatio: 1,
      attributedStackRatio: 1,
      cdpAsyncStackCoverageRatio: 0,
      recordsDropped: input.recordsDropped,
      maxRecords: 1000,
      runWindowCount: 0,
      cpuAttributionCoveragePct: 0,
      cpuAmbiguousSamples: 0,
      ambiguousRatio: 0,
      clockSyncUncertaintyMs: 0,
      reasons: [],
      recommendations: [],
    },
    hotFiles: [],
    topOperations: [],
    chains: [],
    orphans: [],
    concurrencyTimeline: [],
    filteredCounts: {},
    cdpAsyncContexts: [],
    cpuAttribution: {
      available: false,
      attributedCpuPct: 0,
      totalCpuMs: 0,
      cpuAttributedSamples: 0,
      cpuAmbiguousSamples: 0,
      clockSyncUncertaintyMs: 0,
      topChains: [],
    },
  };
}
