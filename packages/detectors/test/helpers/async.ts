import type {
  AsyncKindData,
  AsyncOperationKind,
  AsyncOperationRecord,
  CaptureBundle,
} from '@lanterna-profiler/core';

export function makeAsyncRecord(
  asyncId: number,
  triggerAsyncId: number,
  kind: AsyncOperationKind,
  durationMs: number | undefined,
  initAtMs = 0,
): AsyncOperationRecord {
  return {
    asyncId,
    triggerAsyncId,
    kind,
    rawType: kind.toUpperCase(),
    initAtMs,
    durationMs,
    resolvedAtMs: durationMs !== undefined ? initAtMs + durationMs : undefined,
    destroyedAtMs: undefined,
    runMs: 0,
    runCount: 0,
    orphan: durationMs === undefined,
    initStack: [],
    runWindows: [],
  };
}

export function withAsyncFrame(
  record: AsyncOperationRecord,
  frame: { function: string; file: string; line: number; column?: number },
): AsyncOperationRecord {
  record.initStack = [{ ...frame, column: frame.column ?? 1 }];
  return record;
}

/**
 * Set a creation stack that repeats `frame` `depth` times — the shape
 * recursion-through-promises produces and that `deep-async-chain` keys on
 * (`recursionDepth`).
 */
export function withRecursiveStack(
  record: AsyncOperationRecord,
  frame: { function: string; file: string; line: number; column?: number },
  depth: number,
): AsyncOperationRecord {
  record.initStack = Array.from({ length: depth }, () => ({ ...frame, column: frame.column ?? 1 }));
  return record;
}

export function makeAsyncBundle(args: {
  records: AsyncOperationRecord[];
  concurrency?: AsyncKindData['concurrency'];
  durationMs?: number;
}): CaptureBundle {
  const orphans = args.records.filter((record) => record.orphan).length;
  const data: AsyncKindData = {
    available: true,
    collectedVia: 'async-hooks',
    maxRecords: 50_000,
    records: args.records,
    concurrency: args.concurrency ?? [],
    integrity: {
      recordsDropped: 0,
      initCount: args.records.length,
      destroyCount: 0,
      resolveCount: 0,
      orphanCount: orphans,
    },
    filteredCounts: {},
  };
  return {
    target: {
      pid: 4242,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      cwd: '/app',
    },
    startedAtEpoch: Date.parse('2024-01-01T00:00:00.000Z'),
    durationMs: args.durationMs ?? 5000,
    captureIntegrity: {
      controlChannel: true,
      controlChannelExpected: true,
      eventLoopTimed: false,
      gcTimed: false,
      gcObserverAvailable: false,
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
      kinds: {},
    },
    runtimeSignals: {
      gcEvents: [],
      eventLoopSamples: [],
      eventLoopAvailable: false,
    },
    kinds: { async: data },
  };
}
