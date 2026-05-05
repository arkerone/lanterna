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

    expect(output).toContain('# Lanterna Agent Report');
    expect(output).toContain('## Capture');
    expect(output).toContain('- Mode: spawn');
    expect(output).toContain('- Command: `node server.js`');
    expect(output).toContain('- Source-map coverage: 90.0% coverage (2 maps loaded)');
    expect(output).toContain('## Signal Gate');
    expect(output).toContain('- CPU quality: low');
    expect(output).toContain('- Blocking caveats: control channel unavailable');
    expect(output).toContain('## Action Queue');
    expect(output.indexOf('### 1. Cache grows')).toBeLessThan(
      output.indexOf('### 2. Deopt observed'),
    );
    expect(output.indexOf('### 2. Deopt observed')).toBeLessThan(
      output.indexOf('### 3. Needs another capture'),
    );
    expect(output).toContain('- Priority: 93');
    expect(output).toContain('- Action confidence: high');
    expect(output).toContain('- Proof level: direct-sample');
    expect(output).toContain('- Source: `src/cache.ts:21`');
    expect(output).toContain('- Generated fallback: `/repo/dist/cache.js:8`');
    expect(output).toContain('## Evidence Pack');
    expect(output).toContain('- Observed: slopeBytesPerSec=2048');
    expect(output).toContain('- Thresholds: slopeBytesPerSec=1024');
    expect(output).toContain('- Remediation: cache; notes=Bound cache entries.');
    expect(output).toContain('## Files To Read First');
    expect(output).toContain('1. `src/cache.ts`');
    expect(output).toContain('2. `/repo/dist/hot.js`');
    expect(output).toContain('3. `src/worker.ts`');
    expect(output).toContain('## Decision Rules');
    expect(output).toContain('- f1: actionable');
    expect(output).toContain('- f2: hypothesis');
    expect(output).toContain('- f3: rerun required');
    expect(output).toContain('## Next Commands');
    expect(output).toContain('lanterna run --duration 5s --output report.json -- node server.js');
    expect(output).not.toContain('## Async');
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

    expect(output).toContain('## Action Queue\n\nNo findings.');
    expect(output).toContain('## Next Commands\n\nNo rerun required by report signal.');
    expect(output).not.toContain('## Memory');
    expect(output).not.toContain('## Async');
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

    expect(output).toContain(`- Source: \`${dependencyFile}:255\``);
    expect(output).toContain('Do not patch the dependency file directly');
    expect(output).toContain('No editable user source files identified from findings.');
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
      '- User caller: handleRequest (src/app.ts:44 (/repo/src/app.js:22)) [high, support 92.0%]',
    );
    expect(output).toContain('- f1: actionable');
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
      '- User caller: handleRequest (/repo/src/app.js:22) [medium, support 70.0%]',
    );
    expect(output).toContain('- f1: hypothesis');
  });
});
