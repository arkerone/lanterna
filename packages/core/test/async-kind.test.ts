import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalysisPipeline } from '../src/analysis/core/pipeline.js';
import type { CaptureBundle } from '../src/capture/core/types.js';
import type { CdpClient } from '../src/inspector/client.js';
import { createAsyncProbe, createAsyncProfileKind } from '../src/kinds/async/index.js';
import type { AsyncKindData, AsyncOperationRecord } from '../src/kinds/async/types.js';
import { buildLanternaReport, serializeReport } from '../src/report/index.js';
import { buildReportSchema } from '../src/report/schema.js';
import { createAsyncOperationsInstaller } from '../src/runtime-signals/hooks/installers/async-operations.js';

interface AsyncHookCallbacks {
  init(asyncId: number, type: string, triggerAsyncId: number): void;
  before(asyncId: number): void;
  after(asyncId: number): void;
  destroy(asyncId: number): void;
  promiseResolve(asyncId: number): void;
}

function installAsyncCollector(options: { maxRecords?: number; stackDepth?: number }): {
  callbacks: AsyncHookCallbacks;
  read(): AsyncKindData & { maxRecords: number };
  sampleConcurrency(): void;
} {
  let now = 0;
  let globalValue: { read: () => AsyncKindData & { maxRecords: number } } | undefined;
  let callbacks: Partial<AsyncHookCallbacks> | undefined;
  let sampleConcurrency: (() => void) | undefined;
  vi.stubGlobal('setInterval', (fn: () => void) => {
    sampleConcurrency = fn;
    return { unref() {} };
  });
  const api = {
    performance: { now: () => now },
    registerGlobal: (_name: string, value: unknown) => {
      globalValue = value as typeof globalValue;
    },
    addResetHook: () => {},
    getBuiltin: (name: string) =>
      name === 'async_hooks'
        ? {
            createHook: (hookCallbacks: Partial<AsyncHookCallbacks>) => {
              callbacks = hookCallbacks;
              return { enable() {}, disable() {} };
            },
          }
        : null,
  };

  const installer = createAsyncOperationsInstaller(options);
  new Function('__lanterna', installer.source)(api);
  now += 1;

  if (!globalValue || !callbacks || !sampleConcurrency) {
    throw new Error('async collector failed to install in test harness');
  }
  return {
    callbacks: callbacks as AsyncHookCallbacks,
    read: () => globalValue.read(),
    sampleConcurrency,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(
  asyncId: number,
  triggerAsyncId: number,
  durationMs: number | undefined,
  initAtMs = 0,
  runWindows: Array<{ startMs: number; endMs: number }> = [],
): AsyncOperationRecord {
  return {
    asyncId,
    triggerAsyncId,
    kind: 'promise',
    rawType: 'PROMISE',
    initAtMs,
    durationMs,
    resolvedAtMs: durationMs !== undefined ? initAtMs + durationMs : undefined,
    destroyedAtMs: undefined,
    runMs: 0,
    runCount: 0,
    orphan: durationMs === undefined,
    initStack: [],
    runWindows,
  };
}

function withFrame(
  rec: AsyncOperationRecord,
  frame: { function: string; file: string; line: number; column?: number },
): AsyncOperationRecord {
  rec.initStack = [{ ...frame, column: frame.column ?? 1 }];
  return rec;
}

function makeBundle(records: AsyncOperationRecord[]): CaptureBundle {
  const data: AsyncKindData = {
    available: true,
    collectedVia: 'async-hooks',
    maxRecords: 1000,
    records,
    concurrency: [{ atMs: 0, active: 1, inflight: records.length }],
    integrity: {
      recordsDropped: 0,
      initCount: records.length,
      destroyCount: 0,
      resolveCount: 0,
      orphanCount: records.filter((r) => r.orphan).length,
    },
    filteredCounts: {},
  };
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
    durationMs: 1000,
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
    runtimeSignals: { gcEvents: [], eventLoopSamples: [], eventLoopAvailable: false },
    kinds: { async: data },
  };
}

describe('async kind round-trip', () => {
  it('produces a profiles.async section with chains, top operations and orphans', () => {
    // Chain depth 5 + 1 orphan
    const records: AsyncOperationRecord[] = [];
    for (let i = 1; i <= 5; i++) records.push(record(i, i - 1, 10, i));
    records.push(record(99, 1, undefined, 0));
    const bundle = makeBundle(records);

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    const section = result.profiles.async;
    expect(section).toBeDefined();
    expect(section?.summary.available).toBe(true);
    expect(section?.summary.totalOperations).toBe(6);
    expect(section?.summary.byKind.promise).toBe(6);
    expect(section?.topOperations.length).toBeGreaterThan(0);
    expect(section?.orphans.length).toBe(1);
    expect(section?.chains.length).toBeGreaterThan(0);
  });

  it('attributes CPU samples to async chain roots when run windows overlap samples', () => {
    // Two-resource chain: parent #1 triggers child #2, both with run windows
    // covering 0–100ms. CPU profile has 100 samples evenly spaced 1ms apart.
    const records: AsyncOperationRecord[] = [
      record(1, 0, 100, 0, [{ startMs: 0, endMs: 50 }]),
      record(2, 1, 50, 50, [{ startMs: 50, endMs: 100 }]),
    ];
    records[0].initStack = [
      { function: 'startWork', file: 'file:///app/src/start.js', line: 12, column: 4 },
    ];
    const cpuProfile = {
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
      endTime: 100_000,
      samples: Array.from({ length: 100 }, () => 1),
      timeDeltas: Array.from({ length: 100 }, () => 1000), // 1 ms in µs
    };
    const bundle = makeBundle(records);
    bundle.kinds.cpu = { cpuProfile, deopts: [], samplesTimed: true };

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const attribution = result.profiles.async?.cpuAttribution;
    expect(attribution?.available).toBe(true);
    expect(attribution?.attributedCpuPct).toBeGreaterThan(0);
    // All samples fall under chain rooted at asyncId=1 → 100% under that root.
    expect(attribution?.topChains[0]?.rootAsyncId).toBe(1);
    expect(attribution?.topChains[0]?.cpuPct).toBeGreaterThan(50);
    expect(attribution?.topChains[0]?.rootFrame?.function).toBe('startWork');
  });

  it('returns unavailable cpuAttribution when CPU kind is missing', () => {
    const bundle = makeBundle([record(1, 0, 10, 0, [{ startMs: 0, endMs: 10 }])]);
    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.profiles.async?.cpuAttribution.available).toBe(false);
  });

  it('validates the async report section against the assembled report schema', () => {
    const kind = createAsyncProfileKind();
    const bundle = makeBundle([
      record(1, 0, 10, 0, [{ startMs: 0, endMs: 10 }]),
      record(2, 1, undefined, 20),
    ]);
    const pipeline = createAnalysisPipeline({ kinds: [kind] });
    const options = { command: ['node', 'app.js'], mode: 'spawn' as const };
    const result = pipeline.run(bundle, options);
    const report = buildLanternaReport(bundle, result, [kind], options);

    expect(buildReportSchema([kind]).parse(report)).toEqual(report);
    expect(() => serializeReport(report, { pretty: false, kinds: [kind] })).not.toThrow();
  });

  it('reports async quality, aggregates hot files, and exposes the top async hot file', () => {
    const records = [
      withFrame(record(1, 0, 100, 0, [{ startMs: 0, endMs: 30 }]), {
        function: 'loadUser',
        file: 'file:///app/src/users.js',
        line: 12,
      }),
      withFrame(record(2, 1, 80, 10, [{ startMs: 35, endMs: 55 }]), {
        function: 'loadPosts',
        file: 'file:///app/src/users.js',
        line: 28,
      }),
      withFrame(record(3, 0, undefined, 20), {
        function: 'openSocket',
        file: 'file:///app/src/socket.js',
        line: 7,
      }),
    ];
    const bundle = makeBundle(records);
    bundle.durationMs = 300;
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
        endTime: 60_000,
        samples: Array.from({ length: 60 }, () => 1),
        timeDeltas: Array.from({ length: 60 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const section = result.profiles.async;

    expect(section?.quality).toMatchObject({
      confidence: 'high',
      operationCount: 3,
      sampledStackRatio: 1,
      recordsDropped: 0,
      maxRecords: 1000,
      runWindowCount: 2,
      cpuAttributionCoveragePct: section?.cpuAttribution.attributedCpuPct,
    });
    expect(section?.hotFiles[0]).toMatchObject({
      file: 'file:///app/src/users.js',
      operationCount: 2,
      totalDurationMs: 180,
      primaryFrame: {
        function: 'loadUser',
        file: 'file:///app/src/users.js',
        line: 12,
      },
      kindBreakdown: { promise: 2 },
      sampleAsyncIds: [1, 2],
    });
    expect(section?.summary.topAsyncHotFile).toEqual({
      function: 'loadUser',
      file: 'file:///app/src/users.js',
      line: 12,
      score: section?.hotFiles[0]?.score,
      confidence: section?.hotFiles[0]?.confidence,
    });
  });

  it('degrades async quality when stacks are missing, records are dropped, or collection is cdp-only', () => {
    const records = [
      record(1, 0, 100, 0),
      withFrame(record(2, 0, 50, 5), {
        function: 'partlySampled',
        file: 'file:///app/src/partial.js',
        line: 2,
      }),
    ];
    const bundle = makeBundle(records);
    const data = bundle.kinds.async as AsyncKindData;
    data.collectedVia = 'cdp-only';
    data.integrity.recordsDropped = 3;
    data.maxRecords = 2;

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'attach' });
    const quality = result.profiles.async?.quality;

    expect(quality?.confidence).toBe('low');
    expect(quality?.sampledStackRatio).toBe(0.5);
    expect(quality?.recordsDropped).toBe(3);
    expect(quality?.reasons).toEqual(
      expect.arrayContaining([
        'only 50% of async operations include init stacks',
        '3 async records were dropped because maxRecords=2 was reached',
        'async_hooks data was not available; collection used cdp-only',
      ]),
    );
  });

  it('adds root, deepest, and dominant file frames to async chains', () => {
    const root = withFrame(record(1, 0, 10, 0), {
      function: 'routeHandler',
      file: 'file:///app/src/routes.js',
      line: 4,
    });
    const middle = withFrame(record(2, 1, 20, 1), {
      function: 'serviceCall',
      file: 'file:///app/src/service.js',
      line: 10,
    });
    const leaf = withFrame(record(3, 2, 30, 2), {
      function: 'repoCall',
      file: 'file:///app/src/service.js',
      line: 20,
    });
    const bundle = makeBundle([root, middle, leaf]);

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const chain = result.profiles.async?.chains[0];

    expect(chain?.rootFrame?.function).toBe('routeHandler');
    expect(chain?.deepestFrame?.function).toBe('repoCall');
    expect(chain?.dominantFile).toBe('file:///app/src/service.js');
  });

  it('passes asyncStackDepth through to the async hook installer', () => {
    const kind = createAsyncProfileKind({ asyncStackDepth: 17 });
    expect(kind.hookInstaller?.source).toContain(', 17,');
  });

  it('keeps inflight stable when dropped resources are destroyed', () => {
    const collector = installAsyncCollector({ maxRecords: 1 });
    collector.callbacks.init(1, 'PROMISE', 0);
    collector.callbacks.init(2, 'PROMISE', 0);
    collector.callbacks.destroy(2);

    collector.sampleConcurrency();

    const last = collector.read().concurrency.at(-1);
    expect(last?.inflight).toBe(1);
    expect(collector.read().integrity.destroyCount).toBe(1);
    expect(collector.read().integrity.recordsDropped).toBe(1);
  });

  it('decrements inflight only once for promiseResolve followed by destroy', () => {
    const collector = installAsyncCollector({ maxRecords: 10 });
    collector.callbacks.init(1, 'PROMISE', 0);
    collector.callbacks.promiseResolve(1);
    collector.sampleConcurrency();
    collector.callbacks.destroy(1);
    collector.sampleConcurrency();

    const samples = collector.read().concurrency.slice(-2);
    expect(samples.map((sample) => sample.inflight)).toEqual([0, 0]);
    expect(collector.read().integrity.resolveCount).toBe(1);
    expect(collector.read().integrity.destroyCount).toBe(1);
  });

  it('attributes CPU to a long-running window hidden behind more recent starts', () => {
    const records: AsyncOperationRecord[] = [
      record(1, 0, 1000, 0, [{ startMs: 0, endMs: 1000 }]),
      ...Array.from({ length: 9 }, (_, i) =>
        record(10 + i, 0, 1, 100 + i, [{ startMs: 100 + i, endMs: 101 + i }]),
      ),
    ];
    const bundle = makeBundle(records);
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
        endTime: 500_000,
        samples: [1],
        timeDeltas: [500_000],
      },
      deopts: [],
      samplesTimed: true,
    };

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.profiles.async?.cpuAttribution.topChains[0]?.rootAsyncId).toBe(1);
    expect(result.profiles.async?.cpuAttribution.attributedCpuPct).toBe(100);
  });

  it('marks CPU samples ambiguous when multiple async run windows overlap', () => {
    const records: AsyncOperationRecord[] = [
      record(1, 0, 100, 0, [{ startMs: 0, endMs: 100 }]),
      record(2, 0, 100, 0, [{ startMs: 0, endMs: 100 }]),
    ];
    const bundle = makeBundle(records);
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
        endTime: 10_000,
        samples: Array.from({ length: 10 }, () => 1),
        timeDeltas: Array.from({ length: 10 }, () => 1000),
      },
      deopts: [],
      samplesTimed: true,
    };

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.profiles.async?.cpuAttribution.cpuAmbiguousSamples).toBe(10);
    expect(result.profiles.async?.quality.cpuAmbiguousSamples).toBe(10);
    expect(result.profiles.async?.quality.reasons).toContain(
      '10 CPU samples overlapped multiple async run windows and were marked ambiguous',
    );
  });

  it('surfaces attach partial capture, instrumentation mode, and CDP async stack coverage in quality', () => {
    const records = [record(1, 0, 100, 0)];
    const bundle = makeBundle(records);
    const data = bundle.kinds.async as AsyncKindData;
    data.collectedVia = 'cdp-only';
    data.instrumentationMode = 'safe';
    data.attachPartialCapture = true;
    data.cdpAsyncContexts = [
      {
        source: 'Runtime.exceptionThrown',
        proofLevel: 'cdp-debugger-async-stack',
        capturedAtMs: 12,
        frames: [{ function: 'boom', file: 'file:///app/boom.js', line: 1, column: 1 }],
        asyncStack: [],
      },
    ];

    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'attach' });

    expect(result.profiles.async?.quality).toMatchObject({
      instrumentationMode: 'safe',
      attachPartialCapture: true,
      cdpAsyncStackCoverageRatio: 1,
    });
    expect(result.profiles.async?.quality.reasons).toContain(
      'attach mode can only observe async resources created after hooks were installed',
    );
  });

  it('flags collectedVia=cdp-only when async hook never ran', () => {
    const data: AsyncKindData = {
      available: false,
      collectedVia: 'cdp-only',
      maxRecords: 0,
      records: [],
      concurrency: [],
      integrity: {
        recordsDropped: 0,
        initCount: 0,
        destroyCount: 0,
        resolveCount: 0,
        orphanCount: 0,
      },
      filteredCounts: {},
    };
    const bundle = { ...makeBundle([]), kinds: { async: data } };
    const pipeline = createAnalysisPipeline({ kinds: [createAsyncProfileKind()] });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'attach' });
    expect(result.profiles.async?.summary.available).toBe(false);
    expect(result.profiles.async?.summary.collectedVia).toBe('cdp-only');
  });
});

describe('async installer lifecycle', () => {
  function instrument(): {
    globalValue: { read: () => unknown; disable?: () => void };
    hookDisableCalls: number;
    intervalsCleared: number[];
    intervalsCreated: number[];
  } {
    let nextTimerId = 1;
    const intervalsCreated: number[] = [];
    const intervalsCleared: number[] = [];
    let hookDisableCalls = 0;
    let globalValue: { read: () => unknown; disable?: () => void } | undefined;

    vi.stubGlobal('setInterval', () => {
      const id = nextTimerId++;
      intervalsCreated.push(id);
      return { unref() {}, [Symbol.toPrimitive]: () => id, valueOf: () => id };
    });
    vi.stubGlobal('clearInterval', (timer: { valueOf?: () => number } | number) => {
      const id =
        typeof timer === 'number'
          ? timer
          : typeof timer?.valueOf === 'function'
            ? timer.valueOf()
            : -1;
      intervalsCleared.push(id);
    });

    const api = {
      performance: { now: () => 0 },
      registerGlobal: (_name: string, value: unknown) => {
        globalValue = value as typeof globalValue;
      },
      addResetHook: () => {},
      getBuiltin: (name: string) =>
        name === 'async_hooks'
          ? {
              createHook: () => ({
                enable() {},
                disable() {
                  hookDisableCalls += 1;
                },
              }),
            }
          : null,
    };

    const installer = createAsyncOperationsInstaller({ instrumentationMode: 'off' });
    new Function('__lanterna', installer.source)(api);
    if (!globalValue) throw new Error('installer did not register global');

    return {
      globalValue,
      get hookDisableCalls() {
        return hookDisableCalls;
      },
      intervalsCleared,
      intervalsCreated,
    };
  }

  it('exposes a disable() that clears the concurrency sampler and stops async_hooks', () => {
    const harness = instrument();
    expect(harness.intervalsCreated.length).toBe(1);

    expect(typeof harness.globalValue.disable).toBe('function');
    harness.globalValue.disable?.();

    expect(harness.hookDisableCalls).toBe(1);
    expect(harness.intervalsCleared).toEqual(harness.intervalsCreated);
  });

  it('exposes a no-op disable() when async_hooks is unavailable', () => {
    let globalValue: { read: () => unknown; disable?: () => void } | undefined;
    vi.stubGlobal('setInterval', () => ({ unref() {} }));
    vi.stubGlobal('clearInterval', () => {});
    const api = {
      performance: { now: () => 0 },
      registerGlobal: (_name: string, value: unknown) => {
        globalValue = value as typeof globalValue;
      },
      addResetHook: () => {},
      getBuiltin: () => null,
    };
    const installer = createAsyncOperationsInstaller({});
    new Function('__lanterna', installer.source)(api);

    expect(globalValue).toBeDefined();
    expect(typeof globalValue?.disable).toBe('function');
    expect(() => globalValue?.disable?.()).not.toThrow();
  });
});

describe('async probe lifecycle', () => {
  it('disables the in-target installer over CDP at stop()', async () => {
    const evaluated: string[] = [];
    const sent: string[] = [];
    const cdp: CdpClient = {
      closed: false,
      send: async (method: string) => {
        sent.push(method);
        return {};
      },
      evaluate: async (expression: string) => {
        evaluated.push(expression);
        if (expression.includes('.read?.()')) {
          return {
            available: true,
            maxRecords: 10,
            records: [],
            concurrency: [],
            integrity: {
              recordsDropped: 0,
              initCount: 0,
              destroyCount: 0,
              resolveCount: 0,
              orphanCount: 0,
            },
            filteredCounts: {},
          };
        }
        return null;
      },
      on: () => () => {},
      onClose: () => () => {},
      close: async () => {},
    };

    const probe = createAsyncProbe({ asyncStackDepth: 32 });
    await probe.start(cdp);
    await probe.stop(cdp);

    expect(evaluated.some((e) => e.includes('.read?.()'))).toBe(true);
    expect(evaluated.some((e) => e.includes('.disable?.()'))).toBe(true);
    expect(sent).toContain('Debugger.disable');
  });

  it('does not call disable over CDP when the client is already closed', async () => {
    const evaluated: string[] = [];
    const cdp: CdpClient = {
      closed: true,
      send: async () => ({}),
      evaluate: async (expression: string) => {
        evaluated.push(expression);
        return null;
      },
      on: () => () => {},
      onClose: () => () => {},
      close: async () => {},
    };

    const probe = createAsyncProbe({ asyncStackDepth: 32 });
    await probe.stop(cdp);

    expect(evaluated).toEqual([]);
  });
});

describe('async installer safe-mode patches', () => {
  it('restores Promise.then, setTimeout, and fetch after disable', () => {
    const originalThen = Promise.prototype.then;
    const originalCatch = Promise.prototype.catch;
    const originalFinally = Promise.prototype.finally;
    const originalSetTimeout = globalThis.setTimeout;
    const originalFetch = globalThis.fetch;

    let globalValue: { read: () => unknown; disable?: () => void } | undefined;
    vi.stubGlobal('setInterval', () => ({ unref() {} }));
    vi.stubGlobal('clearInterval', () => {});
    const api = {
      performance: { now: () => 0 },
      registerGlobal: (_name: string, value: unknown) => {
        globalValue = value as typeof globalValue;
      },
      addResetHook: () => {},
      getBuiltin: (name: string) =>
        name === 'async_hooks'
          ? {
              createHook: () => ({ enable() {}, disable() {} }),
              executionAsyncId: () => 0,
            }
          : null,
    };

    const installer = createAsyncOperationsInstaller({ instrumentationMode: 'safe' });
    new Function('__lanterna', installer.source)(api);

    // Patches are in place.
    expect(Promise.prototype.then).not.toBe(originalThen);
    expect(globalThis.setTimeout).not.toBe(originalSetTimeout);

    globalValue?.disable?.();

    // Originals restored.
    expect(Promise.prototype.then).toBe(originalThen);
    expect(Promise.prototype.catch).toBe(originalCatch);
    expect(Promise.prototype.finally).toBe(originalFinally);
    expect(globalThis.setTimeout).toBe(originalSetTimeout);
    if (typeof originalFetch === 'function') expect(globalThis.fetch).toBe(originalFetch);
  });
});

describe('async installer overhead knobs', () => {
  it('stackDepth=0 keeps record bookkeeping but skips stack capture', () => {
    let globalValue:
      | { read: () => { records: Array<{ initStack: unknown[] }> }; disable?: () => void }
      | undefined;
    let callbacks: { init?: (asyncId: number, type: string, triggerAsyncId: number) => void } = {};

    vi.stubGlobal('setInterval', () => ({ unref() {} }));
    vi.stubGlobal('clearInterval', () => {});
    const api = {
      performance: { now: () => 0 },
      registerGlobal: (_name: string, value: unknown) => {
        globalValue = value as typeof globalValue;
      },
      addResetHook: () => {},
      getBuiltin: (name: string) =>
        name === 'async_hooks'
          ? {
              createHook: (cbs: typeof callbacks) => {
                callbacks = cbs;
                return { enable() {}, disable() {} };
              },
            }
          : null,
    };

    const installer = createAsyncOperationsInstaller({
      stackDepth: 0,
      instrumentationMode: 'off',
    });
    new Function('__lanterna', installer.source)(api);
    if (!globalValue || !callbacks.init) throw new Error('install failed');

    callbacks.init(1, 'PROMISE', 0);
    callbacks.init(2, 'TCPWRAP', 0);

    const records = globalValue.read().records;
    expect(records.length).toBe(2);
    for (const rec of records) expect(rec.initStack).toEqual([]);
  });
});

describe('async installer eviction', () => {
  it('evicts the oldest completed record when records exceed maxRecords', () => {
    const now = 0;
    let globalValue: { read: () => { records: Array<{ asyncId: number }> } } | undefined;
    let callbacks: {
      init?: (asyncId: number, type: string, triggerAsyncId: number) => void;
      promiseResolve?: (asyncId: number) => void;
    } = {};

    vi.stubGlobal('setInterval', () => ({ unref() {} }));
    vi.stubGlobal('clearInterval', () => {});
    const api = {
      performance: { now: () => now },
      registerGlobal: (_name: string, value: unknown) => {
        globalValue = value as typeof globalValue;
      },
      addResetHook: () => {},
      getBuiltin: (name: string) =>
        name === 'async_hooks'
          ? {
              createHook: (cbs: typeof callbacks) => {
                callbacks = cbs;
                return { enable() {}, disable() {} };
              },
            }
          : null,
    };

    const installer = createAsyncOperationsInstaller({
      maxRecords: 3,
      instrumentationMode: 'off',
    });
    new Function('__lanterna', installer.source)(api);
    if (!globalValue || !callbacks.init || !callbacks.promiseResolve) {
      throw new Error('installer did not wire async_hooks callbacks');
    }

    // Fill the cap with 3 records, then complete the first two.
    callbacks.init(1, 'PROMISE', 0);
    callbacks.init(2, 'PROMISE', 0);
    callbacks.init(3, 'PROMISE', 0);
    callbacks.promiseResolve(1);
    callbacks.promiseResolve(2);

    // Now add 2 more inits — each should evict an older completed record
    // (asyncIds 1 and 2 in insertion order), not drop the new ones.
    callbacks.init(4, 'PROMISE', 0);
    callbacks.init(5, 'PROMISE', 0);

    const ids = globalValue
      .read()
      .records.map((r) => r.asyncId)
      .sort((a, b) => a - b);
    expect(ids).toEqual([3, 4, 5]);
  });

  it('drops new records when the cap is hit and no completed record can be evicted', () => {
    let globalValue:
      | { read: () => { records: unknown[]; integrity: { recordsDropped: number } } }
      | undefined;
    let callbacks: { init?: (asyncId: number, type: string, triggerAsyncId: number) => void } = {};

    vi.stubGlobal('setInterval', () => ({ unref() {} }));
    vi.stubGlobal('clearInterval', () => {});
    const api = {
      performance: { now: () => 0 },
      registerGlobal: (_name: string, value: unknown) => {
        globalValue = value as typeof globalValue;
      },
      addResetHook: () => {},
      getBuiltin: (name: string) =>
        name === 'async_hooks'
          ? {
              createHook: (cbs: typeof callbacks) => {
                callbacks = cbs;
                return { enable() {}, disable() {} };
              },
            }
          : null,
    };

    const installer = createAsyncOperationsInstaller({
      maxRecords: 2,
      instrumentationMode: 'off',
    });
    new Function('__lanterna', installer.source)(api);
    if (!globalValue || !callbacks.init) throw new Error('install failed');

    // Fill cap; do not resolve any so nothing is evictable.
    callbacks.init(1, 'PROMISE', 0);
    callbacks.init(2, 'PROMISE', 0);
    // Next two should be dropped.
    callbacks.init(3, 'PROMISE', 0);
    callbacks.init(4, 'PROMISE', 0);

    const read = globalValue.read();
    expect(read.records.length).toBe(2);
    expect(read.integrity.recordsDropped).toBe(2);
  });
});
