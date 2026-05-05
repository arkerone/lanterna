import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createAnalysisPipeline } from '../src/analysis/core/pipeline.js';
import type { RawSamplingHeapProfile } from '../src/capture/core/heap.js';
import type { CaptureBundle } from '../src/capture/core/types.js';
import { createMemoryProbe, createMemoryProfileKind } from '../src/kinds/memory/index.js';
import type { MemoryKindData } from '../src/kinds/memory/probe.js';
import { buildLanternaReport, serializeReport } from '../src/report/index.js';
import { memoryProfileReportSchema } from '../src/report/schema/memory-profile.js';
import type { MemoryProfileReport, MemoryUsageSample } from '../src/report/types.js';
import { composeAttachScript } from '../src/runtime-signals/hooks/framework.js';
import { createMemoryUsageInstaller } from '../src/runtime-signals/hooks/installers/memory-usage.js';
import { runtimeSignalsInstaller } from '../src/runtime-signals/hooks/installers/runtime-signals.js';

function bundle(data: MemoryKindData, durationMs = 5000): CaptureBundle {
  return {
    target: {
      pid: 12345,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      cwd: '/app',
    },
    startedAtEpoch: Date.parse('2024-01-01T00:00:00.000Z'),
    durationMs,
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
    kinds: { memory: data },
  };
}

function profile(): RawSamplingHeapProfile {
  // Synthetic shape:
  //   (root)
  //   └─ user fn doWork()        @ /app/src/work.js:10  selfSize 200
  //      └─ allocBuffer()        @ /app/src/util.js:5   selfSize 800
  return {
    head: {
      callFrame: {
        functionName: '(root)',
        scriptId: '0',
        url: '',
        lineNumber: 0,
        columnNumber: 0,
      },
      selfSize: 0,
      id: 1,
      children: [
        {
          callFrame: {
            functionName: 'doWork',
            scriptId: '1',
            url: 'file:///app/src/work.js',
            lineNumber: 10,
            columnNumber: 4,
          },
          selfSize: 200,
          id: 2,
          children: [
            {
              callFrame: {
                functionName: 'allocBuffer',
                scriptId: '2',
                url: 'file:///app/src/util.js',
                lineNumber: 5,
                columnNumber: 2,
              },
              selfSize: 800,
              id: 3,
              children: [],
            },
          ],
        },
      ],
    },
    samples: [],
  };
}

function externalAllocatorProfile(): RawSamplingHeapProfile {
  return {
    head: {
      callFrame: {
        functionName: '(root)',
        scriptId: '0',
        url: '',
        lineNumber: 0,
        columnNumber: 0,
      },
      selfSize: 0,
      id: 1,
      children: [
        {
          callFrame: {
            functionName: 'handleRequest',
            scriptId: '1',
            url: 'file:///app/src/app.js',
            lineNumber: 21,
            columnNumber: 4,
          },
          selfSize: 100,
          id: 2,
          children: [
            {
              callFrame: {
                functionName: 'buildResult',
                scriptId: '2',
                url: 'file:///app/node_modules/pkg/index.js',
                lineNumber: 8,
                columnNumber: 2,
              },
              selfSize: 900,
              id: 3,
              children: [],
            },
          ],
        },
      ],
    },
    samples: [],
  };
}

function series(slopeBytesPerMs: number, count = 20): MemoryUsageSample[] {
  const out: MemoryUsageSample[] = [];
  for (let i = 0; i < count; i++) {
    const atMs = i * 200;
    const rss = 100 * 1024 * 1024 + atMs * slopeBytesPerMs;
    out.push({
      atMs,
      rss,
      heapTotal: rss / 2,
      heapUsed: rss / 3,
      external: 1024 * 1024,
      arrayBuffers: 512 * 1024,
    });
  }
  return out;
}

describe('memory kind analysis', () => {
  it('aggregates allocators from the sampling profile and builds a valid report', () => {
    const data: MemoryKindData = {
      samplingProfile: profile(),
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: { samples: series(0), available: true, sampleIntervalMs: 200 },
      heapSnapshotAnalysis: {
        available: true,
        mode: 'start-end',
        start: { path: '/tmp/start.heapsnapshot' },
        end: { path: '/tmp/end.heapsnapshot' },
        summary: {
          totalRetainedGrowthBytes: 1024,
          topGrowingConstructor: 'LeakedThing',
        },
        growthByConstructor: [
          {
            name: 'LeakedThing',
            countDelta: 1,
            selfSizeDeltaBytes: 512,
            retainedSizeDeltaBytes: 1024,
          },
        ],
        retainerPaths: [
          {
            constructorName: 'LeakedThing',
            retainedBytes: 1024,
            path: ['(GC roots)', 'Map', 'entries', 'LeakedThing'],
            suspectedPattern: 'cache',
            confidence: 'medium',
          },
        ],
        warnings: [],
      },
    };
    const memoryKind = createMemoryProfileKind();
    const pipeline = createAnalysisPipeline({ kinds: [memoryKind] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });

    const report = result.profiles.memory as MemoryProfileReport;
    expect(report).toBeDefined();
    expect(report.summary.totalSampledBytes).toBe(1000);
    expect(report.heapSnapshotAnalysis?.available).toBe(true);
    expect(report.heapSnapshotAnalysis?.summary.topGrowingConstructor).toBe('LeakedThing');

    // Top allocator is inclusive-heavy: doWork's subtree accounts for the whole sample.
    const top = report.hotAllocators[0];
    expect(top.function).toBe('doWork');
    expect(top.file).toBe('src/work.js');
    expect(top.category).toBe('user');
    expect(top.totalBytes).toBe(1000);
    expect(Math.round(top.totalPct)).toBe(100);

    const allocBuffer = report.hotAllocators.find((h) => h.function === 'allocBuffer');
    expect(allocBuffer).toBeDefined();
    expect(allocBuffer?.file).toBe('src/util.js');
    expect(allocBuffer?.selfBytes).toBe(800);
    expect(Math.round(allocBuffer?.selfPct ?? 0)).toBe(80);

    // doWork should be present with self 200, total 1000 (subtree includes child).
    const doWork = report.hotAllocators.find((h) => h.function === 'doWork');
    expect(doWork).toBeDefined();
    expect(doWork?.selfBytes).toBe(200);
    expect(doWork?.totalBytes).toBe(1000);

    // Schema validates.
    expect(memoryProfileReportSchema.safeParse(report).success).toBe(true);
  });

  it('attributes external allocators to the nearest user caller', () => {
    const data: MemoryKindData = {
      samplingProfile: externalAllocatorProfile(),
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: { samples: series(0), available: true, sampleIntervalMs: 200 },
    };
    const pipeline = createAnalysisPipeline({ kinds: [createMemoryProfileKind()] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });

    const report = result.profiles.memory as MemoryProfileReport;
    const allocator = report.hotAllocators.find((entry) => entry.function === 'buildResult');

    expect(allocator?.userCaller).toMatchObject({
      function: 'handleRequest',
      file: 'src/app.js',
      line: 22,
      profilePct: 90,
      supportPct: 100,
      confidence: 'high',
      basis: 'heap-sample-path',
    });
    const userAllocator = report.hotAllocators.find((entry) => entry.function === 'handleRequest');
    expect(userAllocator?.category).toBe('user');
    expect(userAllocator?.userCaller).toBeUndefined();
    expect(memoryProfileReportSchema.safeParse(report).success).toBe(true);
  });

  it('summarizes memory usage samples by default without exposing the raw series', () => {
    const samples = series(0, 12);
    const data: MemoryKindData = {
      samplingProfile: profile(),
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: { samples, available: true, sampleIntervalMs: 200 },
    };
    const pipeline = createAnalysisPipeline({ kinds: [createMemoryProfileKind()] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });

    const report = result.profiles.memory as MemoryProfileReport;
    expect(report.memoryUsage).toEqual({
      available: true,
      sampleIntervalMs: 200,
      sampleCount: 12,
      firstSample: samples[0],
      lastSample: samples.at(-1),
    });
    expect('samples' in report.memoryUsage).toBe(false);
    expect(report.summary.rss).toBeDefined();
    expect(report.summary.heapUsed).toBeDefined();
  });

  it('can include raw memory usage samples when explicitly requested', () => {
    const samples = series(0, 12);
    const data: MemoryKindData = {
      samplingProfile: profile(),
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: { samples, available: true, sampleIntervalMs: 200 },
    };
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind({ includeMemoryUsageSamples: true })],
    });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });

    const report = result.profiles.memory as MemoryProfileReport;
    expect(report.memoryUsage.samples).toEqual(samples);
    expect(report.memoryUsage.sampleCount).toBe(12);
  });

  it('computes a positive linear slope for a growing memory series', () => {
    const slopeBytesPerMs = 1024; // 1 MB / sec
    const data: MemoryKindData = {
      samplingProfile: profile(),
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: {
        samples: series(slopeBytesPerMs),
        available: true,
        sampleIntervalMs: 200,
      },
    };
    const pipeline = createAnalysisPipeline({ kinds: [createMemoryProfileKind()] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });
    const report = result.profiles.memory as MemoryProfileReport;
    const rss = report.summary.rss;
    expect(rss).toBeDefined();
    // slope is bytes/sec; 1024 b/ms ≈ 1_048_576 b/s.
    expect(rss?.slopeBytesPerSec).toBeGreaterThan(900_000);
    expect(rss?.slopeBytesPerSec).toBeLessThan(1_200_000);
  });

  it('returns an empty allocator list when the sampling profile is empty', () => {
    const empty: RawSamplingHeapProfile = {
      head: {
        callFrame: {
          functionName: '(root)',
          scriptId: '0',
          url: '',
          lineNumber: 0,
          columnNumber: 0,
        },
        selfSize: 0,
        id: 1,
        children: [],
      },
      samples: [],
    };
    const data: MemoryKindData = {
      samplingProfile: empty,
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: { samples: [], available: false, sampleIntervalMs: 250 },
    };
    const memoryKind = createMemoryProfileKind();
    const pipeline = createAnalysisPipeline({ kinds: [memoryKind] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });
    const report = result.profiles.memory as MemoryProfileReport;
    expect(report.hotAllocators).toEqual([]);
    expect(report.summary.totalSampledBytes).toBe(0);
    expect(report.summary.rss).toBeUndefined();

    const lanternaReport = buildLanternaReport(bundle(data), result, [memoryKind], {
      command: ['node', 'app.js'],
      mode: 'spawn',
    });
    expect(() =>
      serializeReport(lanternaReport, { pretty: false, kinds: [memoryKind] }),
    ).not.toThrow();
  });

  it('computes externalRatio from external only because arrayBuffers is included there', () => {
    const data: MemoryKindData = {
      samplingProfile: profile(),
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: {
        samples: [
          {
            atMs: 0,
            rss: 200 * 1024 * 1024,
            heapTotal: 100 * 1024 * 1024,
            heapUsed: 50 * 1024 * 1024,
            external: 25 * 1024 * 1024,
            arrayBuffers: 20 * 1024 * 1024,
          },
        ],
        available: true,
        sampleIntervalMs: 250,
      },
    };
    const pipeline = createAnalysisPipeline({ kinds: [createMemoryProfileKind()] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });
    const report = result.profiles.memory as MemoryProfileReport;
    expect(report.summary.externalRatio).toBe(0.5);
  });

  it('orders inclusive-heavy allocators before self-only allocators', () => {
    const data: MemoryKindData = {
      samplingProfile: {
        head: {
          callFrame: {
            functionName: '(root)',
            scriptId: '0',
            url: '',
            lineNumber: 0,
            columnNumber: 0,
          },
          selfSize: 0,
          id: 1,
          children: [
            {
              callFrame: {
                functionName: 'parent',
                scriptId: '1',
                url: 'file:///app/src/parent.js',
                lineNumber: 1,
                columnNumber: 0,
              },
              selfSize: 100,
              id: 2,
              children: [
                {
                  callFrame: {
                    functionName: 'child',
                    scriptId: '2',
                    url: 'file:///app/src/child.js',
                    lineNumber: 1,
                    columnNumber: 0,
                  },
                  selfSize: 900,
                  id: 3,
                  children: [],
                },
              ],
            },
            {
              callFrame: {
                functionName: 'selfOnly',
                scriptId: '3',
                url: 'file:///app/src/self.js',
                lineNumber: 1,
                columnNumber: 0,
              },
              selfSize: 500,
              id: 4,
              children: [],
            },
          ],
        },
        samples: [],
      },
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: { samples: series(0), available: true, sampleIntervalMs: 250 },
    };
    const pipeline = createAnalysisPipeline({ kinds: [createMemoryProfileKind()] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });
    const report = result.profiles.memory as MemoryProfileReport;
    expect(report.hotAllocators[0]?.function).toBe('parent');
  });

  it('rejects invalid memory kind options at the public API boundary', () => {
    expect(() => createMemoryProfileKind({ samplingIntervalBytes: 1023 })).toThrow(
      /memory sampling interval/,
    );
    expect(() => createMemoryProfileKind({ samplingIntervalBytes: 1024.5 })).toThrow(
      /memory sampling interval/,
    );
    expect(() => createMemoryProfileKind({ memoryUsageIntervalMs: 9 })).toThrow(
      /memory usage interval/,
    );
    expect(() =>
      createMemoryProfileKind({ heapSnapshotAnalysis: { maxRetainerDepth: 0 } }),
    ).toThrow(/heap snapshot max retainer depth/);
  });

  it('only enables heap snapshot progress messaging when heap snapshot analysis is enabled', () => {
    const normalProbe = createMemoryProfileKind().createProbe();
    expect(normalProbe.progressMessages).toBeUndefined();
    expect(createMemoryProfileKind().manualStopMessage).toBeUndefined();

    const snapshotKind = createMemoryProfileKind({ heapSnapshotAnalysis: { enabled: true } });
    const snapshotProbe = snapshotKind.createProbe();
    expect(snapshotProbe.progressMessages?.start).toContain('Memory heap snapshot');
    expect(snapshotProbe.progressMessages?.stop).toContain('final Memory heap snapshot');
    expect(snapshotKind.manualStopMessage).toContain('Aborting Memory heap snapshot');
  });

  it('resets memory usage samples when markCaptureStart is called', () => {
    let now = 10_000;
    const context = {
      process,
      performance: { now: () => now },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {},
      setInterval: () => ({ unref() {} }),
      clearInterval: () => {},
      globalThis: {} as Record<string, unknown>,
    };
    context.globalThis = context as unknown as typeof context.globalThis;
    const script = composeAttachScript(
      [runtimeSignalsInstaller, createMemoryUsageInstaller({ sampleIntervalMs: 10 })],
      { resolutionMs: 20 },
    );

    vm.runInNewContext(script, context);
    const memory = context.globalThis.__LANTERNA_MEMORY__ as {
      clear(): void;
      read(): { samples: MemoryUsageSample[] };
    };
    const eventLoop = context.globalThis.__LANTERNA_EVENT_LOOP__ as {
      markCaptureStart(): void;
    };

    memory.clear();
    expect(memory.read().samples).toHaveLength(0);
    now = 25_000;
    eventLoop.markCaptureStart();
    expect(memory.read().samples).toHaveLength(1);
    expect(memory.read().samples[0]?.atMs).toBe(0);
  });

  it('installs memory hooks on a later attach when the framework already exists', () => {
    const context = {
      process,
      performance: { now: () => 0 },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {},
      setInterval: () => ({ unref() {} }),
      clearInterval: () => {},
      globalThis: {} as Record<string, unknown>,
    };
    context.globalThis = context as unknown as typeof context.globalThis;
    const cpuOnlyScript = composeAttachScript([runtimeSignalsInstaller], { resolutionMs: 20 });
    const memoryScript = composeAttachScript(
      [runtimeSignalsInstaller, createMemoryUsageInstaller({ sampleIntervalMs: 10 })],
      { resolutionMs: 20 },
    );

    vm.runInNewContext(cpuOnlyScript, context);
    expect(context.globalThis.__LANTERNA_MEMORY__).toBeUndefined();

    vm.runInNewContext(memoryScript, context);
    expect(context.globalThis.__LANTERNA_MEMORY__).toBeDefined();
  });

  it('exposes a disable() that clears the memory usage sampler', () => {
    const intervalsCleared: unknown[] = [];
    const timer = { unref() {} };
    const context = {
      process,
      performance: { now: () => 0 },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {},
      setInterval: () => timer,
      clearInterval: (value: unknown) => intervalsCleared.push(value),
      globalThis: {} as Record<string, unknown>,
    };
    context.globalThis = context as unknown as typeof context.globalThis;
    const script = composeAttachScript(
      [runtimeSignalsInstaller, createMemoryUsageInstaller({ sampleIntervalMs: 10 })],
      { resolutionMs: 20 },
    );

    vm.runInNewContext(script, context);
    const memory = context.globalThis.__LANTERNA_MEMORY__ as {
      disable(): void;
      read(): { samples: MemoryUsageSample[] };
    };
    memory.disable();

    expect(intervalsCleared).toEqual([timer]);
    expect(memory.read().samples).toHaveLength(0);
  });

  it('disables heap sampling and memory usage during probe dispose', async () => {
    const sent: string[] = [];
    const evaluated: string[] = [];
    const cdp = {
      closed: false,
      send: async (method: string) => {
        sent.push(method);
        return {};
      },
      evaluate: async (expression: string) => {
        evaluated.push(expression);
        return null;
      },
      on: () => () => {},
      onClose: () => () => {},
      close: async () => {},
    };

    const probe = createMemoryProbe({
      samplingIntervalBytes: 512 * 1024,
      memoryUsageIntervalMs: 250,
    });
    await probe.dispose?.({
      cdp,
      mode: 'attach',
      kindId: 'memory',
      stopSucceeded: true,
    });

    expect(evaluated.some((expression) => expression.includes('__LANTERNA_MEMORY__'))).toBe(true);
    expect(sent).toContain('HeapProfiler.disable');
  });
});
