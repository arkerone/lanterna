import type { Finding, LanternaReport } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import {
  collectReadTargets,
  formatReadTargetReason,
} from '../../src/renderers/agent/read-target-collector.js';

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

function report(partial: Partial<LanternaReport>): LanternaReport {
  return {
    meta: baseMeta,
    profiles: {},
    findings: [],
    ...partial,
  } as LanternaReport;
}

function finding(overrides: Partial<Finding> & { id: string; file: string }): Finding {
  return {
    id: overrides.id,
    profileKind: 'cpu',
    severity: 'warning',
    category: 'cpu-hotspot',
    title: overrides.id,
    evidence: {
      file: overrides.file,
      line: 10,
      function: 'hot',
      selfPct: 12,
    },
    priority: { score: 80, actionConfidence: 'high' },
    confidence: 'high',
    proofLevel: 'direct-sample',
    why: 'CPU was sampled here.',
    suggestion: 'Inspect the source.',
    references: [],
    ...overrides,
  } as Finding;
}

describe('read target collector', () => {
  it('classifies actionable finding locations and generated output fallbacks', () => {
    const targets = collectReadTargets(
      report({
        findings: [
          finding({ id: 'source', file: 'src/cache.ts' }),
          finding({ id: 'generated', file: '/repo/dist/server.js' }),
        ],
      }),
    );

    expect(targets).toMatchObject([
      {
        location: 'src/cache.ts:10',
        reason: 'finding-location',
        source: 'finding',
        signal: '12.0% self',
        decision: 'read-first',
      },
      {
        location: '/repo/dist/server.js:10',
        reason: 'generated-output-fallback',
        source: 'finding',
        signal: '12.0% self',
        decision: 'inspect-lead',
        generatedOutput: true,
      },
    ]);
  });

  it('targets high-confidence user callers for dependency and runtime findings', () => {
    const targets = collectReadTargets(
      report({
        findings: [
          finding({
            id: 'dependency',
            file: '/repo/node_modules/pkg/index.js',
            evidence: {
              file: '/repo/node_modules/pkg/index.js',
              line: 20,
              function: 'render',
              selfPct: 37.5,
              extra: {
                userCaller: {
                  function: 'route',
                  file: 'src/app.ts',
                  line: 44,
                  profilePct: 37.5,
                  supportPct: 100,
                  confidence: 'high',
                  basis: 'cpu-sample-path',
                },
              },
            },
          }),
          finding({
            id: 'runtime',
            file: 'node:fs',
            evidence: {
              file: 'node:fs',
              line: 0,
              function: 'readFileSync',
              selfPct: 18,
              extra: {
                userCaller: {
                  function: 'loadConfig',
                  file: '/repo/src/config.js',
                  line: 8,
                  profilePct: 18,
                  supportPct: 100,
                  confidence: 'high',
                  basis: 'cpu-sample-path',
                },
              },
            },
          }),
        ],
      }),
    );

    expect(
      targets.map(({ location, reason, decision }) => ({ location, reason, decision })),
    ).toEqual([
      {
        location: 'src/app.ts:44',
        reason: 'dependency-hotspot-caller',
        decision: 'read-first',
      },
      {
        location: '/repo/src/config.js:8',
        reason: 'runtime-hotspot-caller',
        decision: 'read-first',
      },
    ]);
  });

  it('collects supporting targets from CPU stacks, correlated allocators, and async aggregates', () => {
    const targets = collectReadTargets(
      report({
        profiles: {
          cpu: {
            hotStacks: [
              {
                weightPct: 81,
                frames: [
                  {
                    function: 'pbkdf2Sync',
                    file: 'node:internal/crypto/pbkdf2',
                    line: 62,
                    category: 'node:builtin',
                  },
                  {
                    function: 'hashPassword',
                    file: '/repo/src/auth.js',
                    line: 3,
                    category: 'user',
                  },
                  {
                    function: 'route',
                    file: '/repo/src/server.js',
                    line: 12,
                    category: 'user',
                  },
                ],
              },
            ],
          },
          async: {
            summary: {
              topAsyncHotFile: {
                function: 'loadUser',
                file: '/repo/dist/users.js',
                line: 4,
                source: { file: 'src/users.ts', line: 27 },
                score: 80,
                confidence: 'high',
              },
            },
            topOperations: [],
            hotFiles: [],
            cpuAttribution: {
              topChains: [
                {
                  rootAsyncId: 1,
                  rootKind: 'promise',
                  executionFrame: {
                    function: 'serialize',
                    file: '/repo/dist/serializer.js',
                    line: 14,
                    column: 1,
                    source: { file: 'src/serializer.ts', line: 31 },
                  },
                  cpuPct: 22,
                },
              ],
            },
          },
        },
        findings: [
          finding({
            id: 'sync-crypto',
            file: '/repo/src/auth.js',
            evidence: {
              file: '/repo/src/auth.js',
              line: 3,
              function: 'hashPassword',
              selfPct: 81,
              extra: {
                callee: 'pbkdf2Sync',
                correlatedAllocator: {
                  function: 'allocateToken',
                  file: '/repo/src/cache.js',
                  line: 9,
                  totalPct: 28,
                },
              },
            },
          }),
        ],
      }),
    );

    expect(
      targets.map(({ location, reason, source, signal, decision }) => ({
        location,
        reason,
        source,
        signal,
        decision,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          location: '/repo/src/server.js:12',
          reason: 'cpu-user-stack',
          source: 'finding',
          signal: '81.0% stack',
          decision: 'supporting-context',
        },
        {
          location: '/repo/src/cache.js:9',
          reason: 'correlated-allocator',
          source: 'finding',
          signal: '81.0% self',
          decision: 'inspect-lead',
        },
        {
          location: 'src/users.ts:27',
          reason: 'top-async-hot-file',
          source: 'async',
          signal: 'score 80',
          decision: 'inspect-lead',
        },
        {
          location: 'src/serializer.ts:31',
          reason: 'async-cpu-attribution',
          source: 'async',
          signal: '22.0% CPU',
          decision: 'inspect-lead',
        },
      ]),
    );
  });

  it('deduplicates by strongest decision, sorts by rank, and caps at ten targets', () => {
    const findings = Array.from({ length: 12 }, (_, index) =>
      finding({
        id: `f${index}`,
        file: index === 1 ? '/repo/src/shared.js' : `/repo/src/file-${index}.js`,
        evidence: {
          file: index === 0 ? '/repo/src/shared.js' : `/repo/src/file-${index}.js`,
          line: index + 1,
          function: `hot${index}`,
          selfPct: 30 - index,
        },
        confidence: index === 1 ? 'low' : 'high',
        priority: {
          score: 100 - index,
          actionConfidence: index === 1 ? 'low' : 'high',
        },
      }),
    );

    const targets = collectReadTargets(report({ findings }));

    expect(targets).toHaveLength(10);
    expect(targets[0]).toMatchObject({
      location: '/repo/src/shared.js:1',
      decision: 'read-first',
    });
    expect(targets.filter((target) => target.file === '/repo/src/shared.js')).toHaveLength(1);
    expect(targets.slice(1).every((target, index) => target.rank >= targets[index].rank)).toBe(
      true,
    );
  });

  it('formats reason labels for table rendering', () => {
    expect(formatReadTargetReason('runtime-hotspot-caller')).toBe(
      'user caller for runtime hotspot',
    );
    expect(formatReadTargetReason('async-cpu-attribution')).toBe('async CPU attribution');
  });
});
