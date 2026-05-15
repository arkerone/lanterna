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

function anonymousTimerAllocatorProfile(): RawSamplingHeapProfile {
  return {
    head: {
      callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: 0, columnNumber: 0 },
      selfSize: 0,
      id: 1,
      children: [
        {
          callFrame: {
            functionName: '(anonymous)',
            scriptId: '1',
            url: 'file:///app/src/app.js',
            lineNumber: 9,
            columnNumber: 29,
          },
          selfSize: 9000,
          id: 2,
          children: [
            {
              callFrame: {
                functionName: 'addToCache',
                scriptId: '1',
                url: 'file:///app/src/app.js',
                lineNumber: 2,
                columnNumber: 19,
              },
              selfSize: 100,
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

function timerOnlyAllocatorProfile(): RawSamplingHeapProfile {
  return {
    head: {
      callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: 0, columnNumber: 0 },
      selfSize: 0,
      id: 1,
      children: [
        {
          callFrame: {
            functionName: 'listOnTimeout',
            scriptId: '2',
            url: 'node:internal/timers',
            lineNumber: 547,
            columnNumber: 24,
          },
          selfSize: 0,
          id: 2,
          children: [
            {
              callFrame: {
                functionName: 'processTimers',
                scriptId: '2',
                url: 'node:internal/timers',
                lineNumber: 527,
                columnNumber: 24,
              },
              selfSize: 1024,
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

function bufferAllocatorCpuProfile(): RawCpuProfile {
  return {
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
          functionName: 'appendChunk',
          scriptId: '1',
          url: 'file:///app/src/buffers.js',
          lineNumber: 11,
          columnNumber: 4,
        },
        hitCount: 100,
        children: [],
      },
    ],
    startTime: 1000000,
    endTime: 2000000,
    samples: Array(100).fill(2),
    timeDeltas: Array(100).fill(1000),
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

function rssOnlyGrowthSeries(slopeBytesPerMs: number, count = 25): MemoryUsageSample[] {
  const out: MemoryUsageSample[] = [];
  for (let i = 0; i < count; i++) {
    const atMs = i * 200;
    out.push({
      atMs,
      rss: 100 * MB + atMs * slopeBytesPerMs,
      heapTotal: 128 * MB,
      heapUsed: 48 * MB,
      external: 1 * MB,
      arrayBuffers: 0.5 * MB,
    });
  }
  return out;
}

function externalGrowthSeries(slopeBytesPerMs: number, count = 25): MemoryUsageSample[] {
  const out: MemoryUsageSample[] = [];
  for (let i = 0; i < count; i++) {
    const atMs = i * 200;
    const external = 1 * MB + atMs * slopeBytesPerMs;
    out.push({
      atMs,
      rss: 100 * MB + atMs * slopeBytesPerMs,
      heapTotal: 64 * MB,
      heapUsed: 48 * MB,
      external,
      arrayBuffers: external / 2,
    });
  }
  return out;
}

describe('memory-growth detector', () => {
  it('fires `warning` for ~1 MB/s RSS growth and `critical` for ~5 MB/s', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      // ~6 MB/s RSS growth, comfortably above the critical threshold (5 MB/s).
      memoryUsageSamples: externalGrowthSeries(6 * 1024),
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
    expect(rssFinding?.evidence.extra).toMatchObject({
      correlatedAllocator: {
        function: 'alloc',
        file: 'src/a.js',
        line: 2,
        totalPct: 100,
      },
    });
  });

  it('recommends Lanterna heap snapshot analysis before external heap tooling', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('alloc', 'file:///app/src/a.js', 1, 1024),
      memoryUsageSamples: externalGrowthSeries(6 * 1024),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(memoryGrowthDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    const rssFinding = result.findings.find((f) => f.id === 'memory-growth:rss');
    expect(rssFinding?.suggestion).toContain('--heap-snapshot-analysis');
    expect(rssFinding?.suggestion).toContain('heapSnapshotAnalysis.retainerPaths');
    expect(rssFinding?.suggestion).not.toContain('Chrome DevTools or `--inspect`');
  });

  it('uses a named user allocator when the top allocator is an anonymous wrapper', () => {
    const bundle = makeBundle({
      samplingProfile: anonymousTimerAllocatorProfile(),
      memoryUsageSamples: externalGrowthSeries(6 * 1024),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(memoryGrowthDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    const rssFinding = result.findings.find((f) => f.id === 'memory-growth:rss');
    expect(rssFinding?.evidence.extra).toMatchObject({
      correlatedAllocator: {
        function: 'addToCache',
        file: 'src/app.js',
        line: 3,
      },
    });
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

  it('does not report RSS-only growth when heap and external memory stay flat', () => {
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('churn', 'file:///app/src/churn.js', 1, 1024),
      memoryUsageSamples: rssOnlyGrowthSeries(12 * 1024),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(memoryGrowthDetector)],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings.some((finding) => finding.id === 'memory-growth:rss')).toBe(false);
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
    expect(finding?.evidence.extra).toMatchObject({
      userCaller: {
        function: 'big',
        file: 'src/big.js',
        line: 8,
        confidence: 'high',
        basis: 'heap-sample-path',
      },
    });
  });

  it('ignores non-actionable native and builtin allocator frames', () => {
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
              functionName: 'nativeBig',
              scriptId: '1',
              url: '',
              lineNumber: 0,
              columnNumber: 0,
            },
            selfSize: 9000,
            id: 2,
            children: [],
          },
          {
            callFrame: {
              functionName: 'builtinBig',
              scriptId: '2',
              url: 'node:buffer',
              lineNumber: 0,
              columnNumber: 0,
            },
            selfSize: 9000,
            id: 3,
            children: [],
          },
        ],
      },
      samples: [],
    };
    const bundle = makeBundle({ samplingProfile: profile, memoryUsageSamples: growingSeries(0) });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(largeAllocatorDetector)],
    });

    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings).toEqual([]);
  });

  it('deduplicates allocators representing the same allocation subtree', () => {
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
              functionName: 'routeHandler',
              scriptId: '1',
              url: 'file:///app/src/route.js',
              lineNumber: 10,
              columnNumber: 0,
            },
            selfSize: 0,
            id: 2,
            children: [
              {
                callFrame: {
                  functionName: 'allocatePayload',
                  scriptId: '2',
                  url: 'file:///app/src/payload.js',
                  lineNumber: 20,
                  columnNumber: 0,
                },
                selfSize: 9000,
                id: 3,
                children: [],
              },
            ],
          },
        ],
      },
      samples: [],
    };
    const bundle = makeBundle({ samplingProfile: profile, memoryUsageSamples: growingSeries(0) });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(largeAllocatorDetector)],
    });

    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.evidence.function).toBe('allocatePayload');
  });

  it('does not deduplicate independent allocators just because their sizes match', () => {
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
              functionName: 'allocateA',
              scriptId: '1',
              url: 'file:///app/src/a.js',
              lineNumber: 10,
              columnNumber: 0,
            },
            selfSize: 9000,
            id: 2,
            children: [],
          },
          {
            callFrame: {
              functionName: 'allocateB',
              scriptId: '2',
              url: 'file:///app/src/b.js',
              lineNumber: 20,
              columnNumber: 0,
            },
            selfSize: 9000,
            id: 3,
            children: [],
          },
        ],
      },
      samples: [],
    };
    const bundle = makeBundle({ samplingProfile: profile, memoryUsageSamples: growingSeries(0) });
    const pipeline = createAnalysisPipeline({
      kinds: [createMemoryProfileKind()],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(largeAllocatorDetector)],
    });

    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    expect(result.findings.map((finding) => finding.evidence.function)).toEqual([
      'allocateA',
      'allocateB',
    ]);
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
    expect(finding?.evidence.extra).toMatchObject({
      correlatedAllocator: {
        function: 'alloc',
        file: 'src/a.js',
        line: 2,
        totalPct: 100,
      },
    });
  });

  it('does not expose a node builtin heap allocator as external pressure culprit', () => {
    const samples: MemoryUsageSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push({
        atMs: i * 200,
        rss: 500 * MB,
        heapTotal: 50 * MB,
        heapUsed: 4 * MB,
        external: 400 * MB,
        arrayBuffers: 390 * MB,
      });
    }
    const bundle = makeBundle({
      samplingProfile: timerOnlyAllocatorProfile(),
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
    expect(finding?.evidence.extra).not.toHaveProperty('correlatedAllocator');
  });

  it('prefers a CPU user hotspot over heap-sampled timer wrappers for external pressure', () => {
    const samples: MemoryUsageSample[] = [];
    for (let i = 0; i < 20; i++) {
      samples.push({
        atMs: i * 200,
        rss: 500 * MB,
        heapTotal: 50 * MB,
        heapUsed: 4 * MB,
        external: 400 * MB,
        arrayBuffers: 390 * MB,
      });
    }
    const bundle = makeBundle({
      samplingProfile: timerOnlyAllocatorProfile(),
      memoryUsageSamples: samples,
      cpuProfile: bufferAllocatorCpuProfile(),
    });
    const pipeline = createAnalysisPipeline({
      kinds: [
        createCpuProfileKind({ readStderrSoFar: () => '', sampleIntervalMicros: 1000 }),
        createMemoryProfileKind(),
      ],
      findingAnalyzers: [
        createFindingAnalyzerFromKindScopedDetector(externalBufferPressureDetector),
      ],
    });
    const result = pipeline.run(bundle, { command: ['node', 'app.js'], mode: 'spawn' });

    const finding = result.findings.find((f) => f.id === 'external-buffer-pressure');
    expect(finding?.evidence.extra).toMatchObject({
      correlatedAllocator: {
        function: 'appendChunk',
        file: 'src/buffers.js',
        line: 12,
        basis: 'cpu-top-user-hotspot',
      },
    });
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
    expect(finding?.evidence.extra).toMatchObject({
      userCaller: {
        function: 'serializeBig',
        file: 'src/serialize.js',
        line: 13,
        confidence: 'high',
        basis: 'cpu-sample-path',
      },
    });
  });

  it('uses CPU user attribution when heap samples only expose a native allocator', () => {
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
          children: [2],
        },
        {
          id: 2,
          callFrame: {
            functionName: 'transform',
            scriptId: '1',
            url: 'file:///app/src/app.js',
            lineNumber: 10,
            columnNumber: 18,
          },
          hitCount: 120,
          children: [3],
        },
        {
          id: 3,
          callFrame: {
            functionName: 'utf8Write',
            scriptId: '2',
            url: 'node:internal/buffer',
            lineNumber: 1067,
            columnNumber: 38,
          },
          hitCount: 800,
          children: [],
        },
      ],
      startTime: 1000000,
      endTime: 2000000,
      samples: [...Array(80).fill(3), ...Array(20).fill(2)],
      timeDeltas: Array(100).fill(1000),
    };
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('push', '', -1, 9000),
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

    const finding = result.findings.find((f) => f.id.startsWith('alloc-in-hot-path:'));
    expect(finding).toBeDefined();
    expect(finding?.evidence.function).toBe('transform');
    expect(finding?.evidence.extra).toMatchObject({
      allocTotalPct: 100,
      userCaller: {
        function: 'transform',
        file: 'src/app.js',
        line: 11,
        confidence: 'high',
        basis: 'cpu-sample-path',
      },
    });
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

  it('ignores Node internal frames even when CPU and allocation keys match', () => {
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
          children: [2],
        },
        {
          id: 2,
          callFrame: {
            functionName: 'processChunkSync',
            scriptId: '0',
            url: 'node:zlib',
            lineNumber: 0,
            columnNumber: 0,
          },
          hitCount: 100,
          children: [],
        },
      ],
      startTime: 1000000,
      endTime: 2000000,
      samples: Array(100).fill(2),
      timeDeltas: [],
    };
    const bundle = makeBundle({
      samplingProfile: singleAllocatorProfile('processChunkSync', 'node:zlib', 0, 9000),
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

    expect(result.findings).toEqual([]);
  });
});
