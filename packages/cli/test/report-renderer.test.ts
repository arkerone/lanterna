import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/renderers/index.js';

const baseMeta = {
  schemaVersion: '2',
  nodeVersion: 'v22.0.0',
  v8Version: '12.4',
  platform: 'linux',
  arch: 'x64',
  pid: 1234,
  startedAt: '2026-04-30T10:00:00.000Z',
  durationMs: 1500,
  cwd: '/repo',
  command: ['node', 'server.js'],
  lanternaVersion: '1.5.1',
  mode: 'spawn' as const,
  profileKinds: ['cpu'],
  kinds: {},
  captureIntegrity: {
    controlChannel: true,
    controlChannelExpected: true,
    eventLoopTimed: true,
    gcTimed: true,
    gcObserverAvailable: true,
    controlChannelWriteErrors: 0,
    gcObserverSetupFailed: 0,
    heartbeatDropped: 0,
    kinds: {},
  },
};

describe('renderReport', () => {
  it('renders a CPU-only report as terminal text', () => {
    const output = renderReport(
      {
        meta: baseMeta,
        profiles: {
          cpu: {
            summary: {
              totalCpuMs: 120,
              onCpuRatio: 0.5,
              userCodeRatio: 0.4,
              nodeModulesRatio: 0.1,
              builtinRatio: 0,
              nativeRatio: 0,
              gcRatio: 0.02,
              idleRatio: 0.5,
              topCategory: 'user',
              dominantBlockingKind: null,
            },
            hotspots: [
              {
                id: 'h1',
                function: 'handler',
                file: '/repo/server.js',
                line: 12,
                column: 1,
                category: 'user',
                selfMs: 45,
                selfPct: 37.5,
                totalMs: 60,
                totalPct: 50,
                callers: [],
                callees: [],
                optimizationState: 'optimized',
              },
            ],
            hotStacks: [],
            gc: {
              totalPauseMs: 3,
              count: { scavenge: 1, markSweep: 0, incremental: 0, other: 0 },
              longestPauseMs: 3,
              pausesOver10ms: [],
            },
            eventLoop: {
              maxLagMs: 18,
              p99LagMs: 12,
              p50LagMs: 2,
              meanLagMs: 3,
              sampleCount: 20,
              stallIntervals: [],
              available: true,
              measurementBasis: 'histogram',
              confidence: 'high',
            },
            quality: {
              confidence: 'high',
              sampleCount: 100,
              durationMs: 1500,
              idleRatio: 0.5,
              samplesTimed: true,
              durationBasis: 'timeDeltas',
              reasons: [],
              recommendations: [],
            },
            deopts: [],
          },
        },
        findings: [],
      },
      { format: 'text' },
    );

    expect(output).toContain('Lanterna Report');
    expect(output).toContain('CPU');
    expect(output).toContain('handler');
    expect(output).toContain('No findings');
  });

  it('renders markdown with findings and memory allocators', () => {
    const output = renderReport(
      {
        meta: { ...baseMeta, profileKinds: ['cpu', 'memory'] },
        profiles: {
          memory: {
            summary: {
              totalSampledBytes: 4096,
              samplingIntervalBytes: 524288,
              topAllocator: {
                function: 'allocate',
                file: '/repo/cache.js',
                line: 8,
                selfPct: 60,
                totalPct: 70,
              },
            },
            hotAllocators: [
              {
                id: 'a1',
                function: 'allocate',
                file: '/repo/cache.js',
                line: 8,
                column: 1,
                category: 'user',
                selfBytes: 2048,
                selfPct: 50,
                totalBytes: 3072,
                totalPct: 75,
                callers: [],
                callees: [],
              },
            ],
            memoryUsage: {
              available: false,
              sampleIntervalMs: 250,
              sampleCount: 0,
            },
          },
        },
        findings: [
          {
            id: 'f1',
            profileKind: 'memory',
            severity: 'warning',
            category: 'memory-growth',
            title: 'Cache grows',
            evidence: {
              file: '/repo/cache.js',
              line: 8,
              function: 'allocate',
              selfPct: 50,
            },
            why: 'Retained memory is growing.',
            suggestion: 'Bound the cache.',
            references: [],
          },
        ],
      },
      { format: 'markdown' },
    );

    expect(output).toContain('# Lanterna Report');
    expect(output).toContain('## Findings');
    expect(output).toContain('Cache grows');
    expect(output).toContain('allocate');
  });

  it('prefers source locations in text and markdown while keeping generated locations', () => {
    const report = {
      meta: {
        ...baseMeta,
        captureIntegrity: {
          ...baseMeta.captureIntegrity,
          sourceMaps: {
            enabled: true,
            framesResolved: 2,
            framesUnresolved: 1,
            coverage: 2 / 3,
            mapsLoaded: 1,
            failures: [],
          },
        },
      },
      profiles: {
        cpu: {
          summary: {
            totalCpuMs: 120,
            onCpuRatio: 0.5,
            userCodeRatio: 0.4,
            nodeModulesRatio: 0.1,
            builtinRatio: 0,
            nativeRatio: 0,
            gcRatio: 0.02,
            idleRatio: 0.5,
            topCategory: 'user',
            dominantBlockingKind: null,
          },
          hotspots: [
            {
              id: 'h1',
              function: 'handler',
              file: '/repo/dist/server.js',
              line: 12,
              column: 1,
              source: { file: 'src/server.ts', line: 42 },
              category: 'user',
              selfMs: 45,
              selfPct: 37.5,
              totalMs: 60,
              totalPct: 50,
              callers: [],
              callees: [],
              optimizationState: 'optimized',
            },
          ],
          hotStacks: [],
          gc: {
            totalPauseMs: 3,
            count: { scavenge: 1, markSweep: 0, incremental: 0, other: 0 },
            longestPauseMs: 3,
            pausesOver10ms: [],
          },
          eventLoop: {
            maxLagMs: 18,
            p99LagMs: 12,
            p50LagMs: 2,
            meanLagMs: 3,
            sampleCount: 20,
            stallIntervals: [],
            available: true,
            measurementBasis: 'histogram',
            confidence: 'high',
          },
          quality: {
            confidence: 'high',
            sampleCount: 100,
            durationMs: 1500,
            idleRatio: 0.5,
            samplesTimed: true,
            durationBasis: 'timeDeltas',
            reasons: [],
            recommendations: [],
          },
          deopts: [],
        },
      },
      findings: [
        {
          id: 'f1',
          profileKind: 'cpu',
          severity: 'warning',
          category: 'cpu-hotspot',
          title: 'Hot handler',
          evidence: {
            file: '/repo/dist/server.js',
            line: 12,
            function: 'handler',
            selfPct: 37.5,
            source: { file: 'src/server.ts', line: 42 },
          },
          why: 'Handler is hot.',
          suggestion: 'Inspect handler.',
          references: [],
        },
      ],
    };

    const text = renderReport(report, { format: 'text' });
    const markdown = renderReport(report, { format: 'markdown' });

    for (const output of [text, markdown]) {
      expect(output).toContain('src/server.ts:42 (/repo/dist/server.js:12)');
    }
    expect(text).toContain('Source maps: 66.7% coverage (1 maps loaded)');
    expect(markdown).toContain('| Source maps | 66.7% coverage (1 maps loaded) |');
  });

  it('renders user caller attribution for external hotspots, allocators, and findings', () => {
    const report = {
      meta: { ...baseMeta, profileKinds: ['cpu', 'memory'] },
      profiles: {
        cpu: {
          summary: {
            totalCpuMs: 120,
            onCpuRatio: 0.5,
            userCodeRatio: 0.4,
            nodeModulesRatio: 0.1,
            builtinRatio: 0,
            nativeRatio: 0,
            gcRatio: 0.02,
            idleRatio: 0.5,
            topCategory: 'node_modules',
            dominantBlockingKind: null,
          },
          hotspots: [
            {
              id: 'h1',
              function: 'parsePayload',
              file: '/repo/node_modules/pkg/index.js',
              line: 8,
              column: 1,
              category: 'node_modules',
              selfMs: 45,
              selfPct: 37.5,
              totalMs: 60,
              totalPct: 50,
              callers: [],
              callees: [],
              optimizationState: 'unknown',
              userCaller: {
                function: 'handleRequest',
                file: '/repo/src/app.js',
                line: 22,
                profilePct: 37.5,
                supportPct: 92,
                confidence: 'high',
                basis: 'cpu-sample-path',
              },
            },
          ],
          hotStacks: [],
          gc: {
            totalPauseMs: 0,
            count: { scavenge: 0, markSweep: 0, incremental: 0, other: 0 },
            longestPauseMs: 0,
            pausesOver10ms: [],
          },
          eventLoop: {
            maxLagMs: 0,
            p99LagMs: 0,
            p50LagMs: 0,
            meanLagMs: 0,
            sampleCount: 0,
            stallIntervals: [],
            available: false,
            measurementBasis: 'none',
            confidence: 'none',
          },
          quality: {
            confidence: 'high',
            sampleCount: 100,
            durationMs: 1500,
            idleRatio: 0.5,
            samplesTimed: true,
            durationBasis: 'timeDeltas',
            reasons: [],
            recommendations: [],
          },
          deopts: [],
        },
        memory: {
          summary: { totalSampledBytes: 4096, samplingIntervalBytes: 524288 },
          hotAllocators: [
            {
              id: 'a1',
              function: 'allocate',
              file: '/repo/node_modules/pkg/cache.js',
              line: 12,
              column: 1,
              category: 'node_modules',
              selfBytes: 2048,
              selfPct: 50,
              totalBytes: 3072,
              totalPct: 75,
              userCaller: {
                function: 'loadCache',
                file: '/repo/src/cache.js',
                line: 6,
                profilePct: 50,
                supportPct: 100,
                confidence: 'high',
                basis: 'heap-sample-path',
              },
            },
          ],
          memoryUsage: {
            available: false,
            sampleIntervalMs: 250,
            sampleCount: 0,
          },
        },
      },
      findings: [
        {
          id: 'f1',
          profileKind: 'cpu',
          severity: 'warning',
          category: 'node-modules-hotspot',
          title: 'Dependency is hot',
          evidence: {
            file: '/repo/node_modules/pkg/index.js',
            line: 8,
            function: 'parsePayload',
            selfPct: 37.5,
            extra: {
              proofLevel: 'attributed-caller',
              attributionBasis: 'sample-path',
              attributionConfidence: 'low',
              package: 'pkg',
              callee: 'parsePayload',
              calleeTotalPct: 50,
              userCaller: {
                function: 'handleRequest',
                file: '/repo/src/app.js',
                line: 22,
                profilePct: 37.5,
                supportPct: 45,
                confidence: 'low',
                basis: 'cpu-sample-path',
              },
            },
          },
          why: 'Dependency work dominates.',
          suggestion: 'Inspect caller.',
          references: [],
        },
      ],
    };

    const text = renderReport(report, { format: 'text' });
    const markdown = renderReport(report, { format: 'markdown' });

    expect(text).toContain(
      'User caller: handleRequest (/repo/src/app.js:22) [high, support 92.0%]',
    );
    expect(text).toContain('User caller: loadCache (/repo/src/cache.js:6) [high, support 100.0%]');
    expect(text).toContain('User caller: handleRequest (/repo/src/app.js:22) [low, support 45.0%]');
    expect(markdown).toContain('User caller');
    expect(markdown).toContain('handleRequest (/repo/src/app.js:22) [high, support 92.0%]');
  });
});
