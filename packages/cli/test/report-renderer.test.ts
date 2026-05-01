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
});
