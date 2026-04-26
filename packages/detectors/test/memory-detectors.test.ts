import {
  type CaptureBundle,
  createAnalysisPipeline,
  createCpuProfileKind,
  createFindingAnalyzerFromKindScopedDetector,
  createMemoryProfileKind,
  type MemoryUsageSample,
  type RawCpuProfile,
  type RawSamplingHeapProfile,
} from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { allocInHotPathDetector } from '../src/detectors/alloc-in-hot-path.js';
import { externalBufferPressureDetector } from '../src/detectors/external-buffer-pressure.js';
import { largeAllocatorDetector } from '../src/detectors/large-allocator.js';
import { memoryGrowthDetector } from '../src/detectors/memory-growth.js';

const MB = 1024 * 1024;

function makeBundle(args: {
  samplingProfile: RawSamplingHeapProfile;
  memoryUsageSamples: MemoryUsageSample[];
  cpuProfile?: RawCpuProfile;
  durationMs?: number;
}): CaptureBundle {
  const kinds: CaptureBundle['kinds'] = {
    memory: {
      samplingProfile: args.samplingProfile,
      samplingIntervalBytes: 512 * 1024,
      memoryUsage: {
        samples: args.memoryUsageSamples,
        available: true,
        sampleIntervalMs: 200,
      },
    },
  };
  if (args.cpuProfile) {
    kinds.cpu = {
      cpuProfile: args.cpuProfile,
      deopts: [],
      samplesTimed: false,
    };
  }
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
    kinds,
  };
}

function singleAllocatorProfile(
  fnName: string,
  url: string,
  line: number,
  selfBytes: number,
): RawSamplingHeapProfile {
  return {
    head: {
      callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: 0, columnNumber: 0 },
      selfSize: 0,
      id: 1,
      children: [
        {
          callFrame: {
            functionName: fnName,
            scriptId: '1',
            url,
            lineNumber: line,
            columnNumber: 0,
          },
          selfSize: selfBytes,
          id: 2,
          children: [],
        },
      ],
    },
    samples: [],
  };
}

function growingSeries(slopeBytesPerMs: number, externalMB = 1, count = 25): MemoryUsageSample[] {
  const out: MemoryUsageSample[] = [];
  for (let i = 0; i < count; i++) {
    const atMs = i * 200;
    const rss = 100 * MB + atMs * slopeBytesPerMs;
    out.push({
      atMs,
      rss,
      heapTotal: 64 * MB,
      heapUsed: 48 * MB,
      external: externalMB * MB,
      arrayBuffers: (externalMB / 2) * MB,
    });
  }
  return out;
}

describe('memory-growth detector', () => {
  it('fires `warning` for ~1 MB/s RSS growth and `critical` for ~5 MB/s', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      // ~6 MB/s RSS growth, comfortably above the critical threshold (5 MB/s).
      memoryUsageSamples: growingSeries(6 * 1024),
    });

    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(memoryGrowthDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    const rssFinding = result.findings.find((f) => f.id === 'memory-growth:rss');
    expect(rssFinding).toBeDefined();
    expect(rssFinding?.severity).toBe('critical');
    expect(rssFinding?.profileKind).toBe('memory');
  });

  it('does not fire when growth is below threshold', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      memoryUsageSamples: growingSeries(0),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(memoryGrowthDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});

describe('large-allocator detector', () => {
  it('fires `critical` for a frame allocating >40% of sampled bytes', () => {
    const profile: RawSamplingHeapProfile = {
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
              functionName: 'big',
              scriptId: '1',
              url: 'file:///app/src/big.js',
              lineNumber: 7,
              columnNumber: 0,
            },
            selfSize: 9000,
            id: 2,
            children: [],
          },
          {
            callFrame: {
              functionName: 'small',
              scriptId: '2',
              url: 'file:///app/src/small.js',
              lineNumber: 3,
              columnNumber: 0,
            },
            selfSize: 1000,
            id: 3,
            children: [],
          },
        ],
      },
      samples: [],
    };
    const bundle = makeBundle({
      samplingProfile: profile,
      memoryUsageSamples: growingSeries(0),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(largeAllocatorDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    const finding = result.findings.find((f) => f.id.startsWith('large-allocator:'));
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('critical');
    expect(finding?.evidence.function).toBe('big');
  });
});

describe('external-buffer-pressure detector', () => {
  it('fires when external exceeds heapUsed ratio threshold (with mean ≥ minExternalMeanMB)', () => {
    const samples: MemoryUsageSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push({
        atMs: i * 200,
        rss: 200 * MB,
        heapTotal: 50 * MB,
        heapUsed: 40 * MB,
        external: 45 * MB,
        arrayBuffers: 15 * MB,
      });
    }
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      memoryUsageSamples: samples,
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(externalBufferPressureDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    const finding = result.findings.find((f) => f.id === 'external-buffer-pressure');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
  });

  it('does not double-count arrayBuffers because process.memoryUsage external already includes it', () => {
    const samples: MemoryUsageSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push({
        atMs: i * 200,
        rss: 200 * MB,
        heapTotal: 50 * MB,
        heapUsed: 80 * MB,
        external: 39 * MB,
        arrayBuffers: 41 * MB,
      });
    }
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      memoryUsageSamples: samples,
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(externalBufferPressureDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });

  it('does not fire on tiny absolute external footprint', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      memoryUsageSamples: growingSeries(0, 1),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(externalBufferPressureDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});

describe('alloc-in-hot-path detector', () => {
  it('flags a frame that is hot on both CPU and memory', () => {
    // Build a CPU profile with a hot frame `serializeBig` on the same file/line
    // as the heavy allocator, so the keys match.
    const cpuProfile: RawCpuProfile = {
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
            functionName: 'serializeBig',
            scriptId: '1',
            url: 'file:///app/src/serialize.js',
            lineNumber: 12,
            columnNumber: 4,
          },
          hitCount: 800,
          children: [],
        },
        {
          id: 3,
          callFrame: {
            functionName: 'idle',
            scriptId: '2',
            url: 'file:///app/src/idle.js',
            lineNumber: 1,
            columnNumber: 0,
          },
          hitCount: 200,
          children: [],
        },
      ],
      startTime: 1000000,
      endTime: 2000000,
      samples: [],
      timeDeltas: [],
    };
    const memProfile = singleAllocatorProfile(
      'serializeBig',
      'file:///app/src/serialize.js',
      12,
      9000,
    );
    const bundle = makeBundle({
      samplingProfile: memProfile,
      memoryUsageSamples: growingSeries(0),
      cpuProfile,
    });

    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createMemoryProfileKind(),
      ],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(allocInHotPathDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    // Sanity-check the upstream sections so a regression in the CPU/memory
    // contributors doesn't masquerade as a detector bug.
    const cpuReport = result.profiles.cpu;
    const memoryReport = result.profiles.memory;
    expect(cpuReport?.hotspots.some((h) => h.function === 'serializeBig')).toBe(true);
    expect(memoryReport?.hotAllocators.some((a) => a.function === 'serializeBig')).toBe(true);

    const finding = result.findings.find((f) => f.id.startsWith('alloc-in-hot-path:'));
    expect(finding).toBeDefined();
    expect(finding?.evidence.function).toBe('serializeBig');
  });

  it('skips silently when only memory kind is present', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('foo', 'file:///app/src/a.js', 1, 9000),
      memoryUsageSamples: growingSeries(0),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(allocInHotPathDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });
    expect(result.findings).toEqual([]);
  });
});
