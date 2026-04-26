import { describe, expect, it } from 'vitest';
import { createAnalysisPipeline } from '../src/analysis/core/pipeline.js';
import type { RawSamplingHeapProfile } from '../src/capture/core/heap.js';
import type { CaptureBundle } from '../src/capture/core/types.js';
import { createMemoryProfileKind } from '../src/kinds/memory/index.js';
import type { MemoryKindData } from '../src/kinds/memory/probe.js';
import { memoryProfileReportSchema } from '../src/report/schema/memory-profile.js';
import type { MemoryProfileReport, MemoryUsageSample } from '../src/report/types.js';

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
    };
    const memoryKind = createMemoryProfileKind();
    const pipeline = createAnalysisPipeline({ kinds: [memoryKind] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });

    const report = result.profiles.memory as MemoryProfileReport;
    expect(report).toBeDefined();
    expect(report.summary.totalSampledBytes).toBe(1000);

    // Top allocator should be allocBuffer (800 / 1000 = 80%) with classified file path.
    const top = report.hotAllocators[0];
    expect(top.function).toBe('allocBuffer');
    expect(top.file).toBe('src/util.js');
    expect(top.category).toBe('user');
    expect(top.selfBytes).toBe(800);
    expect(Math.round(top.selfPct)).toBe(80);

    // doWork should be present with self 200, total 1000 (subtree includes child).
    const doWork = report.hotAllocators.find((h) => h.function === 'doWork');
    expect(doWork).toBeDefined();
    expect(doWork?.selfBytes).toBe(200);
    expect(doWork?.totalBytes).toBe(1000);

    // Schema validates.
    expect(memoryProfileReportSchema.safeParse(report).success).toBe(true);
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
      memoryUsage: { samples: [], available: false, sampleIntervalMs: 0 },
    };
    const pipeline = createAnalysisPipeline({ kinds: [createMemoryProfileKind()] });
    const result = pipeline.run(bundle(data), { command: ['node', 'app.js'], mode: 'spawn' });
    const report = result.profiles.memory as MemoryProfileReport;
    expect(report.hotAllocators).toEqual([]);
    expect(report.summary.totalSampledBytes).toBe(0);
    expect(report.summary.rss).toBeUndefined();
  });
});
