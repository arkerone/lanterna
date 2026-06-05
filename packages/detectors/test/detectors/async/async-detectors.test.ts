import {
  type AsyncKindData,
  type AsyncOperationRecord,
  type CaptureBundle,
  createAnalysisPipeline,
  createAsyncProfileKind,
  createCpuProfileKind,
  createFindingAnalyzerFromKindScopedDetector,
} from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { deepAsyncChainDetector } from '../../../src/detectors/async/deep-async-chain.js';
import { eventLoopBlockedAsyncDetector } from '../../../src/detectors/async/event-loop-blocked-async.js';
import { hotAsyncContextDetector } from '../../../src/detectors/async/hot-async-context.js';
import { longAwaitDetector } from '../../../src/detectors/async/long-await.js';
import { microtaskFloodDetector } from '../../../src/detectors/async/microtask-flood.js';
import { orphanAsyncResourceDetector } from '../../../src/detectors/async/orphan-async-resource.js';
import {
  makeAsyncBundle as makeBundle,
  makeAsyncRecord as makeRecord,
  withAsyncFrame as withFrame,
  withRecursiveStack,
} from '../../helpers/async.js';

describe('long-await detector', () => {
  it('fires `critical` for an async op longer than the critical threshold', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    records.push(makeRecord(999, 1, 'promise', 1500));
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('long-await:'));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('critical');
    expect(finding?.profileKind).toBe('async');
    expect(finding?.measurements?.priorityBasis).toEqual({ observed: 1500, threshold: 100 });
  });

  it('does not fire for short async ops', () => {
    const records = Array.from({ length: 10 }, (_, i) => makeRecord(i + 1, 1, 'promise', 10));
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });

  it('does not tell agents to patch dependency frames for long awaits', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    records.push(
      withFrame(makeRecord(999, 1, 'tcp', 1500), {
        function: 'sendWire',
        file: '/app/caches/pnpm-store/mongodb@6.20.0/node_modules/mongodb/lib/cmap/connection.js',
        line: 255,
      }),
    );
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });

    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('long-await:'));

    expect(finding?.suggestion).not.toContain('Open `/app/caches/pnpm-store');
    expect(finding?.suggestion).toContain('Do not patch the dependency file directly');
    expect(finding?.suggestion).toContain('Find the user-code caller');
  });
});

describe('orphan-async-resource detector', () => {
  it('fires when many resources never resolved or destroyed', () => {
    // 60 orphans aged > 1000 ms
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 60; i++) records.push(makeRecord(100 + i, 1, 'tcp', undefined, 1000));
    const bundle = makeBundle({ records, durationMs: 5000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(orphanAsyncResourceDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'orphan-async-resource');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
  });

  it('does not fire for a handful of orphans', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord(100 + i, 1, 'tcp', undefined, 1000),
    );
    const bundle = makeBundle({ records, durationMs: 5000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(orphanAsyncResourceDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});

describe('deep-async-chain detector', () => {
  // Recursion through promises: the recursing frame repeats once per level in
  // the deepest resource's creation stack, so the chain's `recursionDepth` is
  // `repeat`. A short trigger chain (root → leaf) carries that stack.
  function recursiveChain(repeat: number): AsyncOperationRecord[] {
    const frame = { function: 'resolveLevel', file: 'file:///app/src/recurse.js', line: 12 };
    const root = withFrame(makeRecord(1, 0, 'promise', 5, 0), frame);
    const leaf = withRecursiveStack(makeRecord(2, 1, 'promise', 5, 1), frame, repeat);
    return [root, leaf];
  }

  it('fires `warning` on recursion through promises', () => {
    const bundle = makeBundle({ records: recursiveChain(20) });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('deep-async-chain:'));
    expect(finding).toBeDefined();
    expect(finding?.profileKind).toBe('async');
    expect(finding?.severity).toBe('warning');
    expect(finding?.measurements?.observed?.recursionDepth).toBe(20);
    expect(finding?.measurements?.priorityBasis).toEqual({ observed: 20, threshold: 16 });
  });

  it('escalates to `critical` past the recursion-depth threshold', () => {
    const bundle = makeBundle({ records: recursiveChain(40) });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('deep-async-chain:'));
    expect(finding?.severity).toBe('critical');
  });

  it('does not fire on a long sequential `while { await }` loop', () => {
    // 200 iterations chained through `triggerAsyncId` (structural depth 199) but
    // each has a non-recursive single-frame creation stack → recursionDepth 1.
    // This is the queue-consumer / poller false positive the gate exists to stop.
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 200; i++) {
      const trigger = i === 0 ? 0 : i;
      records.push(
        withFrame(makeRecord(i + 1, trigger, 'promise', 1, i * 2), {
          function: 'consume',
          file: 'file:///app/src/consumer.js',
          line: 7,
        }),
      );
    }
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
    // The chain is still reported, just not flagged — structural depth high,
    // recursion depth ~1.
    const chain = result.profiles.async?.chains[0];
    expect(chain?.depth).toBeGreaterThanOrEqual(100);
    expect(chain?.recursionDepth).toBeLessThanOrEqual(1);
  });

  it('does not fire on a `Promise.all` fan-out (wide, not recursive)', () => {
    // One parent fans out to 100 siblings, each a single-frame creation stack:
    // high simultaneous liveness but no recursion → recursionDepth 1.
    const records: AsyncOperationRecord[] = [
      withFrame(makeRecord(1, 0, 'promise', 50, 0), {
        function: 'runBatch',
        file: 'file:///app/src/batch.js',
        line: 3,
      }),
    ];
    for (let i = 0; i < 100; i++) {
      records.push(
        withFrame(makeRecord(i + 2, 1, 'promise', 40, 0), {
          function: 'worker',
          file: 'file:///app/src/batch.js',
          line: 9,
        }),
      );
    }
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });

  it('does not fire on a flat tree', () => {
    const records = Array.from({ length: 30 }, (_, i) => makeRecord(i + 1, 0, 'promise', 5));
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });

  it('does not fire on timer-only chains without user or promise evidence', () => {
    // No user frames → recursionDepth 0; gated out before the timer-only filter.
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 35; i++) {
      const trigger = i === 0 ? 0 : i;
      records.push(makeRecord(i + 1, trigger, 'timer', 5, i));
    }
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings).toEqual([]);
  });
});

describe('microtask-flood detector', () => {
  it('fires when sustained inflight count is high', () => {
    const concurrency = Array.from({ length: 50 }, (_, i) => ({
      atMs: i * 100,
      active: 10,
      inflight: 300,
    }));
    const records = Array.from({ length: 20 }, (_, i) => makeRecord(i + 1, 0, 'promise', 5));
    const bundle = makeBundle({ records, concurrency });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(microtaskFloodDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'microtask-flood');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    expect(finding?.measurements?.priorityBasis).toEqual({ observed: 300, threshold: 200 });
  });

  it('anchors microtask-flood on the top async hot file when stacks are available', () => {
    const concurrency = Array.from({ length: 50 }, (_, i) => ({
      atMs: i * 100,
      active: 10,
      inflight: 300,
    }));
    const records = Array.from({ length: 20 }, (_, i) =>
      withFrame(makeRecord(i + 1, 0, 'promise', 5), {
        function: 'scheduleFanout',
        file: 'file:///app/src/fanout.js',
        line: 31,
      }),
    );
    const bundle = makeBundle({ records, concurrency });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(microtaskFloodDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'microtask-flood');

    expect(finding?.evidence.file).toBe('/app/src/fanout.js');
    expect(finding?.evidence.function).toBe('scheduleFanout');
    expect(finding?.evidence.extra).toMatchObject({
      asyncQuality: 'high',
      hotFileRank: 1,
      recordsDropped: 0,
      sampledStackRatio: 1,
      userCaller: {
        function: 'scheduleFanout',
        file: '/app/src/fanout.js',
        line: 31,
        confidence: 'high',
        basis: 'async-stack',
      },
    });
  });

  it('long-await uses initFrame when present', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    const slow = makeRecord(999, 1, 'promise', 1500);
    slow.initStack = [
      { function: 'fetchUser', file: 'file:///app/src/users.js', line: 42, column: 4 },
    ];
    records.push(slow);
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'long-await:999');
    expect(finding?.evidence.function).toBe('fetchUser');
    expect(finding?.evidence.file).toBe('/app/src/users.js');
    expect(finding?.evidence.line).toBe(42);
    expect(finding?.evidence.extra).toMatchObject({
      userCaller: {
        function: 'fetchUser',
        file: '/app/src/users.js',
        line: 42,
        confidence: 'high',
        basis: 'async-stack',
      },
    });
  });

  it('long-await prefers the async operation init stack over an outer await frame', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    const slow = makeRecord(999, 1, 'promise', 1500);
    slow.initStack = [
      { function: 'slowFetch', file: 'file:///app/src/api.js', line: 24, column: 2 },
      { function: 'loop', file: 'file:///app/src/runner.js', line: 8, column: 2 },
    ];
    slow.awaitStack = [{ function: 'loop', file: 'file:///app/src/runner.js', line: 8, column: 2 }];
    records.push(slow);
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'long-await:999');

    expect(finding?.evidence.function).toBe('slowFetch');
    expect(finding?.evidence.file).toBe('/app/src/api.js');
    expect(finding?.evidence.extra).toMatchObject({
      userCaller: {
        function: 'slowFetch',
        file: '/app/src/api.js',
        line: 24,
      },
    });
  });

  it('long-await skips idle background timers that span the capture window', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    records.push(
      withFrame(makeRecord(999, 1, 'timer', 4800), {
        function: 'testHarnessTimeout',
        file: 'file:///app/src/runner.js',
        line: 4,
      }),
    );
    const bundle = makeBundle({ records, durationMs: 5000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings.some((f) => f.id === 'long-await:999')).toBe(false);
  });

  it('long-await skips unattributed bootstrap handles but still fires for awaited ops', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    // The FILEHANDLE every async capture opens at startup: never ran in JS
    // (runCount 0), no async parent (triggerAsyncId 0), no frames. It must not
    // be reported as a long await.
    records.push(makeRecord(999, 0, 'fs', 352, 8));
    // A genuinely-awaited op of the same duration WITH a frame must still fire —
    // proving the guard is narrow.
    records.push(
      withFrame(makeRecord(888, 1, 'tcp', 352, 8), {
        function: 'queryDatabase',
        file: 'file:///app/src/db.js',
        line: 12,
      }),
    );
    const bundle = makeBundle({ records, durationMs: 7000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings.some((f) => f.id === 'long-await:999')).toBe(false);
    expect(result.findings.some((f) => f.id === 'long-await:888')).toBe(true);
  });

  it('long-await prefers a near-tied operation that actually resumed', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 8; i++) records.push(makeRecord(100 + i, 1, 'promise', 10));
    const wrapper = makeRecord(998, 1, 'promise', 1500);
    wrapper.initStack = [
      { function: 'runBatch', file: 'file:///app/src/app.js', line: 14, column: 2 },
      { function: 'loop', file: 'file:///app/src/app.js', line: 27, column: 2 },
    ];
    const resumed = makeRecord(999, 1, 'promise', 1498);
    resumed.runMs = 0.4;
    resumed.runCount = 1;
    resumed.initStack = [{ function: 'loop', file: 'file:///app/src/app.js', line: 27, column: 2 }];
    records.push(wrapper, resumed);
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const longAwaitFindings = result.findings.filter((f) => f.id.startsWith('long-await:'));

    expect(longAwaitFindings[0]?.id).toBe('long-await:999');
    expect(longAwaitFindings[0]?.evidence.function).toBe('loop');
  });

  it('downgrades confidence when recordsDropped > 0', () => {
    const slow = makeRecord(999, 1, 'promise', 1500);
    const records = [
      ...Array.from({ length: 10 }, (_, i) => makeRecord(i + 1, 0, 'promise', 10)),
      slow,
    ];
    const data: AsyncKindData = {
      available: true,
      collectedVia: 'async-hooks',
      maxRecords: 50,
      records,
      concurrency: [],
      integrity: {
        recordsDropped: 12,
        initCount: records.length + 12,
        destroyCount: 0,
        resolveCount: 0,
        orphanCount: 0,
      },
      filteredCounts: {},
    };
    const bundle: CaptureBundle = { ...makeBundle({ records: [] }), kinds: { async: data } };
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'long-await:999');
    expect(finding?.confidence).toBe('low');
  });

  it('uses a reliable matching hot file and quality evidence when an async operation has no stack', () => {
    const slow = makeRecord(999, 1, 'promise', 1500);
    const records = [
      ...Array.from({ length: 10 }, (_, i) =>
        withFrame(makeRecord(i + 1, 0, 'promise', 10), {
          function: 'queueWork',
          file: 'file:///app/src/queue.js',
          line: 17,
        }),
      ),
      slow,
    ];
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'long-await:999');

    expect(finding?.evidence.file).toBe('/app/src/queue.js');
    expect(finding?.evidence.function).toBe('queueWork');
    expect(finding?.confidence).toBe('medium');
    expect(finding?.evidence.extra).toMatchObject({
      asyncQuality: 'medium',
      hotFileRank: 1,
      recordsDropped: 0,
      sampledStackRatio: 10 / 11,
    });
  });

  it('skips silently when async kind is absent from the capture', () => {
    // Bundle without `async` kind data — detector should skip.
    const bundle: CaptureBundle = {
      ...makeBundle({ records: [] }),
      kinds: {},
    };
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(microtaskFloodDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});

describe('hot-async-context detector', () => {
  it('fires when one chain root accumulates a meaningful share of CPU', () => {
    const root = makeRecord(1, 0, 'promise', 200, 0);
    root.runWindows = [{ startMs: 0, endMs: 200 }];
    root.initStack = [
      { function: 'requestHandler', file: 'file:///app/src/server.js', line: 88, column: 2 },
    ];
    const records = [root];
    const bundle = makeBundle({ records });
    bundle.kinds.cpu = {
      cpuProfile: {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 0,
            children: [],
          },
        ],
        startTime: 0,
        endTime: 200_000,
        samples: Array.from({ length: 200 }, () => 1),
        timeDeltas: Array.from({ length: 200 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };
    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createAsyncProfileKind(),
      ],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(hotAsyncContextDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('hot-async-context:'));
    expect(finding).toBeDefined();
    expect(finding?.evidence.function).toBe('requestHandler');
    expect(finding?.evidence.file).toBe('/app/src/server.js');
    expect(finding?.severity).toBe('critical');
    expect(finding?.measurements?.priorityBasis).toEqual({ observed: 100, threshold: 10 });
    expect(finding?.evidence.extra).toMatchObject({
      entryFrame: {
        function: 'requestHandler',
        file: '/app/src/server.js',
        line: 88,
      },
      userCaller: {
        function: 'requestHandler',
        file: '/app/src/server.js',
        line: 88,
        confidence: 'high',
        basis: 'async-cpu-window',
      },
    });
  });

  it('keeps the CPU execution frame as evidence and exposes the async entry frame', () => {
    const root = makeRecord(1, 0, 'promise', 200, 0);
    root.runWindows = [{ startMs: 0, endMs: 200 }];
    root.initStack = [
      { function: 'processRequest', file: 'file:///app/src/server.js', line: 42, column: 2 },
    ];
    const records = [root];
    const bundle = makeBundle({ records });
    bundle.kinds.cpu = {
      cpuProfile: {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 0,
            children: [2],
          },
          {
            id: 2,
            callFrame: {
              functionName: 'heavyComputation',
              scriptId: '1',
              url: 'file:///app/src/cpu.js',
              lineNumber: 10,
              columnNumber: 0,
            },
            hitCount: 200,
            children: [],
          },
        ],
        startTime: 0,
        endTime: 200_000,
        samples: Array.from({ length: 200 }, () => 2),
        timeDeltas: Array.from({ length: 200 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };
    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createAsyncProfileKind(),
      ],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(hotAsyncContextDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('hot-async-context:'));

    expect(finding?.evidence.function).toBe('heavyComputation');
    expect(finding?.evidence.extra).toMatchObject({
      entryFrame: {
        function: 'processRequest',
        file: '/app/src/server.js',
        line: 42,
      },
      userCaller: {
        function: 'processRequest',
        file: '/app/src/server.js',
        line: 42,
        basis: 'async-cpu-window',
      },
    });
  });

  it('skips silently when CPU kind is absent', () => {
    const records = [makeRecord(1, 0, 'promise', 100, 0)];
    records[0].runWindows = [{ startMs: 0, endMs: 100 }];
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(hotAsyncContextDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});

describe('deep async chain anchoring', () => {
  it('anchors on the dominant chain file (the recursion), not the chain root', () => {
    // The recursion lives in deep.js; the chain root is a separate frame in
    // root.js. Each deeper resource was created one level further into the
    // recursion, so the deepest carries the full recursive creation stack. The
    // finding must anchor on the dominant file (deep.js), not the root frame.
    const recurse = { function: 'resolveLevel', file: 'file:///app/src/deep.js', line: 9 };
    const records: AsyncOperationRecord[] = [];
    records.push(
      withFrame(makeRecord(1, 0, 'promise', 5, 0), {
        function: 'rootStep',
        file: 'file:///app/src/root.js',
        line: 2,
      }),
    );
    for (let i = 2; i <= 35; i++) {
      records.push(withRecursiveStack(makeRecord(i, i - 1, 'promise', 5, i), recurse, i - 1));
    }
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(deepAsyncChainDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id.startsWith('deep-async-chain:'));

    expect(finding?.evidence.file).toBe('/app/src/deep.js');
    expect(finding?.evidence.extra).toMatchObject({
      dominantFile: '/app/src/deep.js',
      recursionDepth: 34,
      rootFrame: expect.objectContaining({ file: '/app/src/root.js' }),
      deepestFrame: expect.objectContaining({ file: '/app/src/deep.js' }),
      asyncQuality: 'high',
      userCaller: {
        function: 'resolveLevel',
        file: '/app/src/deep.js',
        confidence: 'high',
        basis: 'async-stack',
      },
    });
  });
});

describe('async detector edge cases', () => {
  it('escalates orphan-async-resource to critical above the critical threshold', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 600; i++) records.push(makeRecord(100 + i, 1, 'tcp', undefined, 1000));
    const bundle = makeBundle({ records, durationMs: 5000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(orphanAsyncResourceDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'orphan-async-resource');
    expect(finding?.severity).toBe('critical');
  });

  it('adds userCaller evidence for orphan async resources with init stacks', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 60; i++) {
      records.push(
        withFrame(makeRecord(100 + i, 1, 'tcp', undefined, 1000), {
          function: 'openSocket',
          file: 'file:///app/src/socket.js',
          line: 16,
        }),
      );
    }
    const bundle = makeBundle({ records, durationMs: 5000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(orphanAsyncResourceDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'orphan-async-resource');

    expect(finding?.evidence.extra).toMatchObject({
      userCaller: {
        function: 'openSocket',
        file: '/app/src/socket.js',
        line: 16,
        confidence: 'high',
        basis: 'async-stack',
      },
    });
  });

  it('skips orphans younger than minOrphanAgeMs', () => {
    const records: AsyncOperationRecord[] = [];
    // 200 fresh orphans (initAt close to capture end → ageMs < 1s).
    for (let i = 0; i < 200; i++) records.push(makeRecord(100 + i, 1, 'tcp', undefined, 4900));
    const bundle = makeBundle({ records, durationMs: 5000 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(orphanAsyncResourceDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });

  it('caps long-await findings at maxFindings', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 5; i++) records.push(makeRecord(i + 1, 1, 'promise', 10));
    // 12 distinct slow ops (each awaited from a real context) — only the top 5
    // should produce findings.
    for (let i = 0; i < 12; i++) records.push(makeRecord(1000 + i, 1, 'promise', 200 + i * 10));
    const bundle = makeBundle({ records });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const longAwaitFindings = result.findings.filter((f) => f.id.startsWith('long-await:'));
    expect(longAwaitFindings.length).toBeLessThanOrEqual(5);
    expect(longAwaitFindings.length).toBeGreaterThan(0);
  });

  it('does not fire long-await when fewer than minOperations were captured', () => {
    const records = [makeRecord(1, 0, 'promise', 1500)];
    const bundle = makeBundle({ records, durationMs: 200 });
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});

describe('long-await latency cause', () => {
  it('classifies a slow op as event-loop-blocked when its wait overlaps a stall', () => {
    const records: AsyncOperationRecord[] = [];
    for (let i = 0; i < 5; i++) {
      records.push(
        withFrame(makeRecord(10 + i, 1, 'promise', 10), {
          function: 'warm',
          file: '/app/src/warm.js',
          line: 1,
        }),
      );
    }
    const slow = withFrame(makeRecord(999, 1, 'promise', 600), {
      function: 'handler',
      file: '/app/src/handler.js',
      line: 5,
    });
    records.push(slow);
    const bundle = makeBundle({ records });
    bundle.captureIntegrity.eventLoopTimed = true;
    bundle.runtimeSignals = {
      gcEvents: [],
      eventLoopSamples: [{ atMs: 500, lagMs: 400 }],
      eventLoopAvailable: true,
    };
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(longAwaitDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'long-await:999');
    expect(finding?.evidence.extra).toMatchObject({
      latencyCause: 'event-loop-blocked',
      waitMs: 600,
    });
    expect(finding?.suggestion).toContain('event loop');
  });
});

describe('event-loop-blocked-async detector', () => {
  function bundleWithStallAndCpu(): CaptureBundle {
    const slow = withFrame(makeRecord(999, 0, 'promise', 600), {
      function: 'handler',
      file: '/app/src/handler.js',
      line: 5,
    });
    const bundle = makeBundle({ records: [slow] });
    bundle.captureIntegrity.eventLoopTimed = true;
    bundle.runtimeSignals = {
      gcEvents: [],
      eventLoopSamples: [{ atMs: 400, lagMs: 400 }],
      eventLoopAvailable: true,
    };
    bundle.kinds.cpu = {
      cpuProfile: {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 0,
            children: [2],
          },
          {
            id: 2,
            callFrame: {
              functionName: 'blockingFn',
              scriptId: '1',
              url: 'file:///app/src/block.js',
              lineNumber: 10,
              columnNumber: 0,
            },
            hitCount: 400,
            children: [],
          },
        ],
        startTime: 0,
        endTime: 400_000,
        samples: Array.from({ length: 400 }, () => 2),
        timeDeltas: Array.from({ length: 400 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };
    return bundle;
  }

  it('emits a correlated-window finding tying the slow op to the blocked loop', () => {
    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createAsyncProfileKind(),
      ],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(eventLoopBlockedAsyncDetector),
      ],
    });
    const result = pipeline.run(bundleWithStallAndCpu(), {
      command: ['node', 'app.js'],
      mode: 'spawn',
    });
    const finding = result.findings.find((f) => f.id === 'event-loop-blocked-async:999');
    expect(finding).toBeDefined();
    expect(finding?.proofLevel).toBe('correlated-window');
    expect(finding?.category).toBe('event-loop-blocked-async');
    expect(finding?.evidence.extra).toMatchObject({ waitMs: 600 });
    expect(finding?.measurements?.priorityBasis).toEqual({ observed: 600, threshold: 100 });
  });

  it('skips silently when the CPU kind is absent', () => {
    const bundle = bundleWithStallAndCpu();
    bundle.kinds.cpu = undefined;
    const pipeline = createAnalysisPipeline({
      kinds: [createAsyncProfileKind()],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(eventLoopBlockedAsyncDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });

  it('stays silent when no CPU hotspot identifies the blocking frame', () => {
    const bundle = bundleWithStallAndCpu();
    // All CPU time is in (root): the correlation finds no user culprit frame, so
    // this detector has nothing actionable to point at and must not emit a
    // placeholder `(event-loop)` finding (the generic stall finding covers it).
    bundle.kinds.cpu = {
      cpuProfile: {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 400,
            children: [],
          },
        ],
        startTime: 0,
        endTime: 400_000,
        samples: Array.from({ length: 400 }, () => 1),
        timeDeltas: Array.from({ length: 400 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };
    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createAsyncProfileKind(),
      ],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(eventLoopBlockedAsyncDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings.some((f) => f.category === 'event-loop-blocked-async')).toBe(false);
  });

  it('attributes each blocked op to its own stall frame, not one global frame', () => {
    // Two distinct blockers: blockA stalls the loop during [0,300], blockB during
    // [500,800]. opA becomes runnable at 300 (blocked by A), opB at 800 (by B).
    const opA = { ...makeRecord(901, 0, 'timer', 300, 0), firstRunAtMs: 300 };
    const opB = { ...makeRecord(902, 0, 'timer', 300, 500), firstRunAtMs: 800 };
    const bundle = makeBundle({ records: [opA, opB], durationMs: 1000 });
    bundle.captureIntegrity.eventLoopTimed = true;
    bundle.runtimeSignals = {
      gcEvents: [],
      eventLoopSamples: [
        { atMs: 300, lagMs: 300 },
        { atMs: 800, lagMs: 300 },
      ],
      eventLoopAvailable: true,
    };
    bundle.kinds.cpu = {
      cpuProfile: {
        nodes: [
          {
            id: 1,
            callFrame: {
              functionName: '(root)',
              scriptId: '0',
              url: '',
              lineNumber: -1,
              columnNumber: -1,
            },
            hitCount: 0,
            children: [2, 3],
          },
          {
            id: 2,
            callFrame: {
              functionName: 'blockA',
              scriptId: '1',
              url: 'file:///app/blockA.js',
              lineNumber: 1,
              columnNumber: 0,
            },
            hitCount: 300,
            children: [],
          },
          {
            id: 3,
            callFrame: {
              functionName: 'blockB',
              scriptId: '2',
              url: 'file:///app/blockB.js',
              lineNumber: 1,
              columnNumber: 0,
            },
            hitCount: 300,
            children: [],
          },
        ],
        startTime: 0,
        endTime: 1_000_000,
        samples: [
          ...Array(300).fill(2), // blockA during [0,300]
          ...Array(200).fill(1), // gap
          ...Array(300).fill(3), // blockB during [500,800]
          ...Array(200).fill(1), // tail
        ],
        timeDeltas: Array.from({ length: 1000 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };
    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createAsyncProfileKind(),
      ],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(eventLoopBlockedAsyncDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const a = result.findings.find((f) => f.id === 'event-loop-blocked-async:901');
    const b = result.findings.find((f) => f.id === 'event-loop-blocked-async:902');
    expect(a?.evidence.function).toBe('blockA');
    expect(b?.evidence.function).toBe('blockB');
  });
});
