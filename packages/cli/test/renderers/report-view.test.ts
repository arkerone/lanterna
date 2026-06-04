import type { LanternaReport } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { buildReportView } from '../../src/renderers/report-view.js';

const baseReport: LanternaReport = {
  meta: {
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
    mode: 'spawn',
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
  },
  findings: [],
};

describe('report view', () => {
  it('suppresses a duplicate top request entry behind one report view policy', () => {
    const view = buildReportView({
      ...baseReport,
      profiles: {
        cpu: {
          summary: {
            topCpuCulprit: {
              function: 'handler',
              file: '/repo/dist/server.js',
              line: 42,
              selfPct: 39,
              totalPct: 55,
              source: { file: '/repo/src/server.ts', line: 11 },
            },
            topRequestEntry: {
              function: 'handler',
              file: '/repo/dist/server.js',
              line: 42,
              selfPct: 39,
              totalPct: 55,
              source: { file: '/repo/src/server.ts', line: 11 },
            },
          },
        },
      },
    });

    expect(view.cpu?.topCpuCulprit?.function).toBe('handler');
    expect(view.cpu?.topRequestEntry).toBeUndefined();
  });

  it('extracts finding user callers and candidate callers once for renderers', () => {
    const view = buildReportView({
      ...baseReport,
      findings: [
        {
          id: 'sync-io-on-hot-path:readConfig',
          profileKind: 'cpu',
          severity: 'warning',
          category: 'sync-io',
          title: 'Synchronous I/O on hot path',
          evidence: {
            function: 'readFileSync',
            file: '/repo/src/config.ts',
            line: 8,
            selfPct: 21,
            extra: {
              userCaller: {
                function: 'loadConfig',
                file: '/repo/src/config.ts',
                line: 3,
                profilePct: 21,
                supportPct: 78,
                confidence: 'high',
                basis: 'stack',
              },
              candidateCallers: [
                {
                  function: 'bootstrap',
                  file: '/repo/src/main.ts',
                  line: 2,
                  profilePct: 21,
                  supportPct: 51,
                  confidence: 'medium',
                  basis: 'stack',
                  stackDistance: 2,
                },
              ],
            },
          },
          confidence: 'high',
          proofLevel: 'direct-sample',
          why: 'Synchronous I/O was sampled in user code.',
          suggestion: 'Load this file before the hot path.',
          references: [],
        },
      ],
    });

    expect(view.findings[0]?.userCaller?.function).toBe('loadConfig');
    expect(view.findings[0]?.candidateCallers).toHaveLength(1);
    expect(view.findings[0]?.candidateCallers[0]?.function).toBe('bootstrap');
  });
});
