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

  it('renders deterministic agent markdown for source-backed action queues', () => {
    const output = renderReport(
      {
        meta: {
          ...baseMeta,
          profileKinds: ['cpu', 'memory'],
          captureIntegrity: {
            ...baseMeta.captureIntegrity,
            controlChannel: false,
            heartbeatDropped: 2,
            sourceMaps: {
              enabled: true,
              framesResolved: 9,
              framesUnresolved: 1,
              coverage: 0.9,
              mapsLoaded: 2,
              failures: [],
            },
          },
        },
        profiles: {
          cpu: {
            quality: {
              confidence: 'low',
              sampleCount: 80,
              durationMs: 1500,
              idleRatio: 0.9,
              samplesTimed: true,
              durationBasis: 'timeDeltas',
              reasons: ['only 80 CPU samples captured'],
              recommendations: ['Rerun with --duration 5s and representative load.'],
            },
          },
          memory: {
            memoryUsage: {
              available: true,
              sampleIntervalMs: 250,
              sampleCount: 8,
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
              file: '/repo/dist/cache.js',
              line: 8,
              function: 'allocate',
              selfPct: 50,
              source: { file: 'src/cache.ts', line: 21 },
            },
            measurements: {
              observed: { slopeBytesPerSec: 2048 },
              thresholds: { slopeBytesPerSec: 1024 },
            },
            priority: {
              score: 93,
              impactEstimateMs: 12,
              actionConfidence: 'high',
            },
            confidence: 'high',
            proofLevel: 'direct-sample',
            remediation: {
              kind: 'cache',
              notes: 'Bound cache entries.',
            },
            why: 'Heap usage keeps growing during the capture.',
            suggestion: 'Bound the cache.',
            references: [],
          },
          {
            id: 'f2',
            profileKind: 'cpu',
            severity: 'info',
            category: 'deopt-loop',
            title: 'Deopt observed',
            evidence: {
              file: '/repo/dist/hot.js',
              line: 3,
              function: 'hot',
              selfPct: 12,
            },
            priority: {
              score: 10,
              actionConfidence: 'low',
            },
            confidence: 'low',
            proofLevel: 'trace-only',
            why: 'A deopt trace was observed.',
            suggestion: 'Inspect type stability.',
            references: [],
          },
          {
            id: 'f3',
            profileKind: 'cpu',
            severity: 'warning',
            category: 'unknown-proof',
            title: 'Needs another capture',
            evidence: {
              file: '/repo/dist/worker.js',
              line: 13,
              function: 'work',
              selfPct: 8,
              source: { file: 'src/worker.ts', line: 31 },
            },
            priority: {
              score: 8,
              actionConfidence: 'high',
            },
            confidence: 'medium',
            why: 'The report did not include enough proof metadata.',
            suggestion: 'Rerun before patching.',
            references: [],
          },
        ],
      },
      { format: 'agent' },
    );

    expect(output.startsWith('---\n')).toBe(true);
    expect(output).toContain('mode: spawn');
    expect(output).toContain('command: "node server.js"');
    expect(output).toContain('kinds: [cpu, memory]');
    expect(output).toContain('cpu_quality: low');
    expect(output).toContain('integrity: degraded');
    expect(output).toContain('sourcemap_coverage: 0.9');
    expect(output).toContain('"control channel unavailable"');
    expect(output).toContain('## Findings');
    expect(output).toMatch(
      /\| 1 +\| f1 +\| memory \| 93 +\|.*\| actionable +\| src\/cache\.ts:21 +\|/,
    );
    expect(output).toMatch(/\| 2 +\| f2 +\| cpu .*\| hypothesis +\|/);
    expect(output).toMatch(/\| 3 +\| f3 +\| cpu .*\| rerun +\|/);
    expect(output.indexOf('## Finding 1 — f1')).toBeLessThan(output.indexOf('## Finding 2 — f2'));
    expect(output.indexOf('## Finding 2 — f2')).toBeLessThan(output.indexOf('## Finding 3 — f3'));
    expect(output).toContain('- title: Cache grows');
    expect(output).toContain('- location: src/cache.ts:21 (fallback /repo/dist/cache.js:8)');
    expect(output).toContain('- observed: slopeBytesPerSec=2048');
    expect(output).toContain('- thresholds: slopeBytesPerSec=1024');
    expect(output).toContain('- remediation: kind=cache notes=Bound cache entries.');
    expect(output).toContain('## Kind Review — cpu');
    expect(output).toContain('- quality: low');
    expect(output).toContain('## Kind Review — memory');
    expect(output).toContain('- memory_usage: 8 samples every 250ms');
    expect(output).toContain('## Files To Read First');
    expect(output).toContain('1. `src/cache.ts`');
    expect(output).toContain('2. `/repo/dist/hot.js`');
    expect(output).toContain('3. `src/worker.ts`');
    expect(output).toContain('## Next Commands');
    expect(output).toContain('lanterna run --duration 5s --output report.json -- node server.js');
    expect(output).not.toContain('## Kind Review — async');
  });

  it('renders agent reports without rerun commands when signal is sufficient', () => {
    const output = renderReport(
      {
        meta: baseMeta,
        profiles: {
          cpu: {
            quality: {
              confidence: 'high',
              sampleCount: 250,
              durationMs: 5000,
              idleRatio: 0.2,
              samplesTimed: true,
              durationBasis: 'timeDeltas',
              reasons: [],
              recommendations: [],
            },
          },
        },
        findings: [],
      },
      { format: 'agent' },
    );

    expect(output).toContain('## Findings\n\n_no findings_');
    expect(output).toContain('## Kind Review — cpu');
    expect(output).toContain('## Next Commands\n\n_no rerun required by report signal_');
    expect(output).not.toContain('## Kind Review — memory');
    expect(output).not.toContain('## Kind Review — async');
  });

  it('renders kind review summaries and uses aggregate files when findings are absent', () => {
    const output = renderReport(
      {
        meta: {
          ...baseMeta,
          profileKinds: ['cpu', 'memory', 'async'],
          captureIntegrity: {
            ...baseMeta.captureIntegrity,
            sourceMaps: {
              enabled: true,
              framesResolved: 1,
              framesUnresolved: 3,
              coverage: 0.25,
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
              topCategory: 'node_modules',
              dominantBlockingKind: null,
              topUserHotspot: {
                id: 'h1',
                function: 'handler',
                file: '/repo/dist/server.js',
                line: 12,
                selfPct: 37.5,
                totalPct: 50,
                source: { file: 'src/server.ts', line: 42 },
              },
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
                  function: 'handler',
                  file: '/repo/dist/server.js',
                  line: 12,
                  source: { file: 'src/server.ts', line: 42 },
                  profilePct: 37.5,
                  supportPct: 92,
                  confidence: 'high',
                  basis: 'cpu-sample-path',
                },
              },
            ],
            hotStacks: [
              {
                weightPct: 25,
                frames: [
                  {
                    function: 'handler',
                    file: '/repo/dist/server.js',
                    line: 12,
                    category: 'user',
                    source: { file: 'src/server.ts', line: 42 },
                  },
                ],
              },
            ],
            hotStackClusters: [
              {
                anchor: {
                  function: 'handler',
                  file: '/repo/dist/server.js',
                  line: 12,
                  source: { file: 'src/server.ts', line: 42 },
                },
                weightPct: 25,
                stackCount: 1,
                memberIndices: [0],
              },
            ],
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
          memory: {
            summary: {
              totalSampledBytes: 4096,
              samplingIntervalBytes: 524288,
              topAllocator: {
                function: 'Buffer.alloc',
                file: 'node:buffer',
                line: 10,
                selfPct: 60,
                totalPct: 70,
                userCaller: {
                  function: 'loadCache',
                  file: '/repo/dist/cache.js',
                  line: 6,
                  source: { file: 'src/cache.ts', line: 18 },
                  profilePct: 60,
                  supportPct: 100,
                  confidence: 'high',
                  basis: 'heap-sample-path',
                },
              },
            },
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
                  file: '/repo/dist/cache.js',
                  line: 6,
                  source: { file: 'src/cache.ts', line: 18 },
                  profilePct: 50,
                  supportPct: 100,
                  confidence: 'high',
                  basis: 'heap-sample-path',
                },
              },
            ],
            memoryUsage: {
              available: true,
              sampleIntervalMs: 250,
              sampleCount: 4,
            },
          },
          async: {
            summary: {
              available: true,
              collectedVia: 'async-hooks',
              totalOperations: 5,
              byKind: { promise: 5 },
              orphanCount: 0,
              recordsDropped: 0,
              topAsyncHotFile: {
                function: 'loadUsers',
                file: '/repo/dist/users.js',
                line: 9,
                source: { file: 'src/users.ts', line: 27 },
                score: 80,
                confidence: 'high',
                userCaller: {
                  function: 'route',
                  file: '/repo/dist/routes.js',
                  line: 3,
                  source: { file: 'src/routes.ts', line: 11 },
                  profilePct: 20,
                  supportPct: 85,
                  confidence: 'high',
                  basis: 'async-stack',
                },
              },
            },
            quality: {
              confidence: 'high',
              instrumentationMode: 'safe',
              attachPartialCapture: false,
              operationCount: 5,
              sampledStackRatio: 1,
              initStackCoverageRatio: 1,
              cdpAsyncStackCoverageRatio: 0,
              recordsDropped: 0,
              maxRecords: 10000,
              runWindowCount: 2,
              cpuAttributionCoveragePct: 80,
              cpuAmbiguousSamples: 0,
              clockSyncUncertaintyMs: 1,
              reasons: [],
              recommendations: [],
            },
            hotFiles: [
              {
                file: '/repo/dist/users.js',
                score: 80,
                confidence: 'high',
                primaryFrame: {
                  function: 'loadUsers',
                  file: '/repo/dist/users.js',
                  line: 9,
                  column: 1,
                  source: { file: 'src/users.ts', line: 27 },
                },
                operationCount: 5,
                totalDurationMs: 100,
                orphanCount: 0,
                maxOrphanAgeMs: 0,
                maxChainDepth: 2,
                cpuPct: 20,
                runMs: 40,
                kindBreakdown: { promise: 5 },
                sampleAsyncIds: [1],
                userCaller: {
                  function: 'route',
                  file: '/repo/dist/routes.js',
                  line: 3,
                  source: { file: 'src/routes.ts', line: 11 },
                  profilePct: 20,
                  supportPct: 85,
                  confidence: 'high',
                  basis: 'async-stack',
                },
              },
            ],
            topOperations: [
              {
                asyncId: 1,
                kind: 'promise',
                rawType: 'PROMISE',
                durationMs: 100,
                runMs: 40,
                runCount: 1,
                initAtMs: 0,
                triggerAsyncId: 0,
                orphan: false,
                primaryFrame: {
                  function: 'loadUsers',
                  file: '/repo/dist/users.js',
                  line: 9,
                  column: 1,
                  source: { file: 'src/users.ts', line: 27 },
                },
                initStack: [],
              },
            ],
            chains: [],
            orphans: [],
            concurrencyTimeline: [],
            filteredCounts: {},
            cdpAsyncContexts: [],
            cpuAttribution: {
              available: true,
              attributedCpuPct: 20,
              totalCpuMs: 40,
              cpuAttributedSamples: 4,
              cpuAmbiguousSamples: 0,
              clockSyncUncertaintyMs: 1,
              topChains: [
                {
                  rootAsyncId: 1,
                  rootKind: 'promise',
                  cpuPct: 20,
                  cpuMs: 40,
                  contributingOperations: 1,
                  userCaller: {
                    function: 'route',
                    file: '/repo/dist/routes.js',
                    line: 3,
                    source: { file: 'src/routes.ts', line: 11 },
                    profilePct: 20,
                    supportPct: 85,
                    confidence: 'medium',
                    basis: 'async-cpu-window',
                  },
                },
              ],
            },
          },
        },
        findings: [],
      },
      { format: 'agent' },
    );

    expect(output).toContain('"source-map coverage below 70%"');
    expect(output).toContain('## Findings\n\n_no findings_');
    expect(output).toContain('## Kind Review — cpu');
    expect(output).toContain('- top_user_hotspot: handler at src/server.ts:42');
    expect(output).toMatch(
      /\| 1 +\| parsePayload +\| \/repo\/node_modules\/pkg\/index\.js:8 .*src\/server\.ts:42 \(high\)/,
    );
    expect(output).toContain(
      '- top_allocator: Buffer.alloc at node:buffer:10 — user_caller loadCache at src/cache.ts:18 (high, heap-sample-path, support 100.0%)',
    );
    expect(output).toContain(
      '- top_async_hot_file: loadUsers at src/users.ts:27 — user_caller route at src/routes.ts:11 (high, async-stack, support 85.0%)',
    );
    expect(output).toMatch(/\| 1 \| promise +\|.*src\/routes\.ts:11 \(medium\)/);
    expect(output).toContain('1. `src/server.ts`');
    expect(output).toContain('2. `src/cache.ts`');
    expect(output).toContain('3. `src/users.ts`');
    expect(output).toContain('4. `src/routes.ts`');
  });

  it('renders async top operation user callers as inspection targets', () => {
    const output = renderReport(
      {
        meta: { ...baseMeta, profileKinds: ['async'] },
        profiles: {
          async: {
            summary: {
              available: true,
              collectedVia: 'async-hooks',
              totalOperations: 1,
              byKind: { tcp: 1 },
              orphanCount: 0,
              recordsDropped: 0,
            },
            quality: {
              confidence: 'high',
              instrumentationMode: 'safe',
              attachPartialCapture: false,
              operationCount: 1,
              sampledStackRatio: 1,
              initStackCoverageRatio: 1,
              cdpAsyncStackCoverageRatio: 0,
              recordsDropped: 0,
              maxRecords: 10000,
              runWindowCount: 1,
              cpuAttributionCoveragePct: 0,
              cpuAmbiguousSamples: 0,
              clockSyncUncertaintyMs: 1,
              reasons: [],
              recommendations: [],
            },
            hotFiles: [],
            topOperations: [
              {
                asyncId: 42,
                kind: 'tcp',
                rawType: 'TCPWRAP',
                durationMs: 1200,
                runMs: 25,
                runCount: 2,
                initAtMs: 10,
                triggerAsyncId: 1,
                orphan: false,
                primaryFrame: {
                  function: 'sendWire',
                  file: '/repo/node_modules/mongodb/lib/cmap/connection.js',
                  line: 255,
                  column: 7,
                },
                userCaller: {
                  function: 'loadUsers',
                  file: '/repo/dist/users.js',
                  line: 9,
                  source: { file: 'src/users.ts', line: 27 },
                  profilePct: 12,
                  supportPct: 88,
                  confidence: 'high',
                  basis: 'async-stack',
                },
                initStack: [],
              },
            ],
            chains: [],
            orphans: [],
            concurrencyTimeline: [],
            filteredCounts: {},
            cdpAsyncContexts: [],
            cpuAttribution: {
              available: false,
              reason: 'cpu kind absent',
              attributedCpuPct: 0,
              totalCpuMs: 0,
              cpuAttributedSamples: 0,
              cpuAmbiguousSamples: 0,
              clockSyncUncertaintyMs: 1,
              topChains: [],
            },
          },
        },
        findings: [],
      },
      { format: 'agent' },
    );

    expect(output).toMatch(
      /\| 1 \| tcp +\| 42 +\| \/repo\/node_modules\/mongodb\/lib\/cmap\/connection\.js:255 \| 1200 +\| src\/users\.ts:27 \(high\) \|/,
    );
    expect(output).toContain('1. `src/users.ts`');
    expect(output).not.toContain('1. `/repo/node_modules/mongodb/lib/cmap/connection.js`');
  });

  it('keeps custom profile kinds generic in agent kind review', () => {
    const output = renderReport(
      {
        meta: { ...baseMeta, profileKinds: ['custom-profiler'] },
        profiles: {},
        findings: [],
      },
      { format: 'agent' },
    );

    expect(output).toContain('## Kind Review — custom-profiler');
    expect(output).toContain(
      '_custom kind: inspect the declared profile kind and report shape without assuming a built-in section key_',
    );
    expect(output).not.toContain('## Kind Review — cpu');
    expect(output).not.toContain('## Kind Review — memory');
    expect(output).not.toContain('## Kind Review — async');
  });

  it('keeps virtual source-map paths out of files to read first', () => {
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
              topUserHotspot: {
                id: 'h1',
                function: 'handler',
                file: '/repo/dist/server.js',
                line: 12,
                selfPct: 37.5,
                totalPct: 50,
                source: { file: 'webpack://app/src/server.ts', line: 42 },
              },
            },
            hotspots: [],
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
      { format: 'agent' },
    );

    expect(output).toContain('- top_user_hotspot: handler at webpack://app/src/server.ts:42');
    expect(output).toContain(
      '_no editable user source files identified from findings or aggregates_',
    );
    expect(output).not.toContain('1. `webpack://app/src/server.ts`');
  });

  it('does not list dependency frames as files to patch in agent reports', () => {
    const dependencyFile =
      '/repo/caches/pnpm-store/mongodb@6.20.0/node_modules/mongodb/lib/cmap/connection.js';
    const output = renderReport(
      {
        meta: { ...baseMeta, profileKinds: ['async'] },
        profiles: {},
        findings: [
          {
            id: 'long-await:999',
            profileKind: 'async',
            severity: 'warning',
            category: 'long-io-await',
            title: 'sendWire kept an async tcp alive 1500ms',
            evidence: {
              file: dependencyFile,
              line: 255,
              function: 'sendWire',
              selfPct: 0,
            },
            priority: {
              score: 50,
              actionConfidence: 'medium',
            },
            confidence: 'high',
            proofLevel: 'direct-sample',
            why: 'A driver operation stayed alive for 1500ms.',
            suggestion:
              'Do not patch the dependency file directly. Find the user-code caller that starts this MongoDB operation and configure a timeout or abort path there.',
            references: [],
          },
        ],
      },
      { format: 'agent' },
    );

    expect(output).toContain(`- location: ${dependencyFile}:255`);
    expect(output).toContain('Do not patch the dependency file directly');
    expect(output).toContain(
      '_no editable user source files identified from findings or aggregates_',
    );
    expect(output).not.toContain(`1. \`${dependencyFile}\``);
  });

  it('uses high-confidence user callers as agent inspection targets for external findings', () => {
    const dependencyFile = '/repo/node_modules/pkg/index.js';
    const output = renderReport(
      {
        meta: baseMeta,
        profiles: {},
        findings: [
          {
            id: 'f1',
            profileKind: 'cpu',
            severity: 'warning',
            category: 'node-modules-hotspot',
            title: 'Dependency is hot',
            evidence: {
              file: dependencyFile,
              line: 8,
              function: 'parsePayload',
              selfPct: 37.5,
              extra: {
                proofLevel: 'attributed-caller',
                userCaller: {
                  function: 'handleRequest',
                  file: '/repo/src/app.js',
                  line: 22,
                  source: { file: 'src/app.ts', line: 44 },
                  profilePct: 37.5,
                  supportPct: 92,
                  confidence: 'high',
                  basis: 'cpu-sample-path',
                },
              },
            },
            priority: {
              score: 80,
              actionConfidence: 'high',
            },
            confidence: 'high',
            proofLevel: 'direct-sample',
            why: 'Dependency work dominates.',
            suggestion: 'Inspect caller.',
            references: [],
          },
        ],
      },
      { format: 'agent' },
    );

    expect(output).toContain(
      '- user_caller: handleRequest at src/app.ts:44 (high, cpu-sample-path, support 92.0%)',
    );
    expect(output).toMatch(/\| 1 +\| f1 +\|.*\| actionable +\|/);
    expect(output).toContain('1. `src/app.ts`');
    expect(output).not.toContain(`1. \`${dependencyFile}\``);
  });

  it('keeps medium-confidence user callers as agent inspection leads', () => {
    const output = renderReport(
      {
        meta: baseMeta,
        profiles: {},
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
                userCaller: {
                  function: 'handleRequest',
                  file: '/repo/src/app.js',
                  line: 22,
                  profilePct: 37.5,
                  supportPct: 70,
                  confidence: 'medium',
                  basis: 'async-cpu-window',
                },
              },
            },
            priority: {
              score: 80,
              actionConfidence: 'high',
            },
            confidence: 'high',
            proofLevel: 'direct-sample',
            why: 'Dependency work dominates.',
            suggestion: 'Inspect caller.',
            references: [],
          },
        ],
      },
      { format: 'agent' },
    );

    expect(output).toContain(
      '- user_caller: handleRequest at /repo/src/app.js:22 (medium, async-cpu-window, support 70.0%)',
    );
    expect(output).toMatch(/\| 1 +\| f1 +\|.*\| hypothesis +\|/);
  });
});
