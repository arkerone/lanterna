import { describe, expect, it } from 'vitest';
import type { CaptureBundle } from '../src/capture/core/types.js';
import { createAsyncFrameReporter } from '../src/kinds/async/analysis/frames.js';
import { analyzeAsyncOperations } from '../src/kinds/async/analysis/operation-analysis.js';
import type { AsyncKindData, AsyncOperationRecord } from '../src/kinds/async/types.js';

describe('async operation analysis', () => {
  it('builds the operation bundle behind one module interface', () => {
    const records = [
      operation(1, 0, 30, 0),
      operation(2, 1, undefined, 10),
      operation(3, 1, 80, 5),
    ];
    const data = asyncData(records);
    const bundle = captureBundle(data);
    bundle.captureIntegrity.eventLoopTimed = true;
    bundle.runtimeSignals.eventLoopSamples = [{ atMs: 20, lagMs: 50 }];

    const analysis = analyzeAsyncOperations({
      data,
      bundle,
      frameReporter: createAsyncFrameReporter(),
    });

    expect(analysis.sortedByDuration.map((record) => record.asyncId)).toEqual([2, 3, 1]);
    expect(analysis.topOperations.map((operation) => operation.asyncId)).toEqual([3, 1]);
    expect(analysis.signals).toEqual({ eventLoop: true, gc: false });
  });
});

function operation(
  asyncId: number,
  triggerAsyncId: number,
  durationMs: number | undefined,
  initAtMs: number,
): AsyncOperationRecord {
  return {
    asyncId,
    triggerAsyncId,
    kind: 'promise',
    rawType: 'PROMISE',
    initAtMs,
    durationMs,
    resolvedAtMs: durationMs === undefined ? undefined : initAtMs + durationMs,
    runMs: 0,
    runCount: 0,
    orphan: durationMs === undefined,
    initStack: [],
    runWindows: [],
  };
}

function asyncData(records: AsyncOperationRecord[]): AsyncKindData {
  return {
    available: true,
    collectedVia: 'async-hooks',
    maxRecords: 1000,
    records,
    concurrency: [],
    integrity: {
      recordsDropped: 0,
      initCount: records.length,
      destroyCount: 0,
      resolveCount: 0,
      orphanCount: records.filter((record) => record.orphan).length,
    },
    filteredCounts: {},
  };
}

function captureBundle(data: AsyncKindData): CaptureBundle {
  return {
    target: {
      pid: 1,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      cwd: '/app',
    },
    startedAtEpoch: 0,
    durationMs: 100,
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
