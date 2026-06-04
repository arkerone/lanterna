import { describe, expect, it } from 'vitest';
import { createAsyncProfileKind } from '../src/kinds/async/index.js';
import {
  asyncProfileReportSchema,
  parseAsyncProfileReport,
} from '../src/kinds/async/report-contract.js';
import type { AsyncProfileReport } from '../src/report/types.js';

describe('async report contract', () => {
  it('is the schema published by the async kind', () => {
    expect(createAsyncProfileKind().reportSchema).toBe(asyncProfileReportSchema);
  });

  it('validates the complete async report shape through one contract module', () => {
    const report = richAsyncReport();

    expect(parseAsyncProfileReport(report)).toEqual(report);
  });

  it('rejects async reports missing required quality fields', () => {
    const report = richAsyncReport() as AsyncProfileReport & {
      quality: Partial<AsyncProfileReport['quality']>;
    };
    delete report.quality.ambiguousRatio;

    expect(() => parseAsyncProfileReport(report)).toThrow();
  });
});

function richAsyncReport(): AsyncProfileReport {
  const frame = {
    function: 'loadUsers',
    file: '/repo/src/users.ts',
    line: 27,
    column: 3,
    source: { file: 'src/users.ts', line: 27, column: 3 },
  };
  const userCaller = {
    function: 'routeUsers',
    file: '/repo/src/routes.ts',
    line: 9,
    column: 1,
    profilePct: 41,
    supportPct: 89,
    confidence: 'high' as const,
    basis: 'async-stack' as const,
    stackDistance: 1,
  };

  return {
    summary: {
      available: true,
      collectedVia: 'async-hooks',
      totalOperations: 2,
      byKind: { promise: 2 },
      durationStats: { p50Ms: 22, p95Ms: 44, p99Ms: 44, maxMs: 44, meanMs: 33 },
      concurrency: { meanInflight: 1.5, maxInflight: 2, meanActive: 0.5, maxActive: 1 },
      orphanCount: 0,
      recordsDropped: 0,
      byKindLatency: {
        promise: { count: 2, p50Ms: 12, p95Ms: 34, p99Ms: 34, maxMs: 34, meanWaitMs: 18 },
      },
      topAsyncHotFile: {
        function: frame.function,
        file: frame.file,
        line: frame.line,
        score: 82,
        confidence: 'high',
        source: frame.source,
        userCaller,
      },
    },
    quality: {
      confidence: 'high',
      instrumentationMode: 'safe',
      attachPartialCapture: false,
      operationCount: 2,
      sampledStackRatio: 1,
      initStackCoverageRatio: 1,
      attributedStackRatio: 1,
      cdpAsyncStackCoverageRatio: 0.5,
      recordsDropped: 0,
      maxRecords: 50_000,
      runWindowCount: 2,
      cpuAttributionCoveragePct: 41,
      cpuAmbiguousSamples: 0,
      ambiguousRatio: 0,
      clockSyncUncertaintyMs: 0.25,
      reasons: [],
      recommendations: [],
    },
    hotFiles: [
      {
        file: frame.file,
        score: 82,
        confidence: 'high',
        primaryFrame: frame,
        operationCount: 2,
        totalDurationMs: 66,
        orphanCount: 0,
        maxOrphanAgeMs: 0,
        maxChainDepth: 2,
        cpuPct: 41,
        runMs: 16,
        kindBreakdown: { promise: 2 },
        sampleAsyncIds: [1, 2],
        userCaller,
      },
    ],
    topOperations: [
      {
        asyncId: 2,
        kind: 'promise',
        rawType: 'PROMISE',
        durationMs: 44,
        runMs: 10,
        runCount: 1,
        initAtMs: 4,
        triggerAsyncId: 1,
        orphan: false,
        firstRunAtMs: 15,
        waitMs: 34,
        scheduleDelayMs: 11,
        latencyCause: 'io-wait',
        causeConfidence: 'medium',
        causeEvidence: { overlapPct: 0, basis: 'none', windowMs: 44 },
        attributedFrameOrigin: 'inherited-trigger',
        initFrame: frame,
        primaryFrame: frame,
        primaryReason: 'creation',
        creationFrame: frame,
        executionFrame: frame,
        awaitFrame: frame,
        promiseRegistrationFrame: frame,
        promiseHandlerFrame: frame,
        creationConfidence: 'high',
        executionConfidence: 'medium',
        awaitConfidence: 'medium',
        cpuAttributedSamples: 4,
        cpuAmbiguousSamples: 0,
        clockSyncUncertaintyMs: 0.25,
        overallConfidence: 'high',
        userCaller,
        initStack: [frame],
      },
    ],
    chains: [
      {
        rootAsyncId: 1,
        rootKind: 'promise',
        depth: 2,
        recursionDepth: 1,
        totalOperations: 2,
        totalDurationMs: 66,
        deepestPath: ['promise', 'promise'],
        rootFrame: frame,
        deepestFrame: frame,
        dominantFile: frame.file,
      },
    ],
    orphans: [],
    concurrencyTimeline: [{ atMs: 20, active: 1, inflight: 2 }],
    filteredCounts: { tickobject: 3 },
    cdpAsyncContexts: [
      {
        source: 'Runtime.consoleAPICalled',
        proofLevel: 'cdp-debugger-async-stack',
        capturedAtMs: 25,
        frames: [frame],
        asyncStack: [{ description: 'await', frames: [frame] }],
      },
    ],
    cpuAttribution: {
      available: true,
      attributedCpuPct: 41,
      totalCpuMs: 120,
      cpuAttributedSamples: 4,
      cpuAmbiguousSamples: 0,
      clockSyncUncertaintyMs: 0.25,
      topChains: [
        {
          rootAsyncId: 1,
          rootKind: 'promise',
          rootFrame: frame,
          executionFrame: frame,
          executionConfidence: 'high',
          cpuPct: 41,
          cpuMs: 49.2,
          contributingOperations: 2,
          userCaller: { ...userCaller, basis: 'async-cpu-window' },
        },
      ],
    },
  };
}
