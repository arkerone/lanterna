import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineFindingAnalyzer } from '../src/analysis/core/pipeline.js';
import { createCaptureIntegrity } from '../src/capture/core/session.js';
import { defineProfileKind } from '../src/kinds/core/types.js';

const mocks = vi.hoisted(() => ({
  buildLanternaReport: vi.fn(),
  runCapture: vi.fn(),
}));

vi.mock('../src/capture/coordinator.js', () => ({
  createManualStopSignal: () => ({ trigger: vi.fn(), promise: new Promise<void>(() => {}) }),
  runCapture: mocks.runCapture,
}));

vi.mock('../src/capture/spawn.js', () => ({
  SpawnSource: class SpawnSource {},
}));

vi.mock('../src/capture/attach.js', () => ({
  AttachSource: class AttachSource {},
}));

vi.mock('../src/report/index.js', () => ({
  buildLanternaReport: mocks.buildLanternaReport,
}));

const { attachProfile, runProfile } = await import('../src/profile/profile.js');

const testKind = defineProfileKind({
  id: 'test',
  reportSectionKey: 'test',
  reportSchema: z.unknown(),
  createProbe() {
    return {
      start: async () => {},
      stop: async () => ({}),
    };
  },
  createAnalysisContributor() {
    return {
      analyze(context) {
        context.writeSection({ ok: true });
      },
    };
  },
});

const testFinding = defineFindingAnalyzer({
  id: 'test.finding',
  kind: 'finding',
  run() {
    return [
      {
        id: 'test.finding',
        profileKind: 'test',
        severity: 'info',
        category: 'test',
        title: 'Test finding',
        evidence: {
          file: 'test.js',
          line: 1,
          function: 'handler',
          selfPct: 1,
        },
        why: 'why',
        suggestion: 'suggestion',
        references: [],
      },
    ];
  },
});

function makeBundle() {
  return {
    target: {
      pid: 1234,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      cwd: '/app',
    },
    startedAtEpoch: Date.parse('2024-01-01T00:00:00.000Z'),
    durationMs: 100,
    captureIntegrity: createCaptureIntegrity(),
    runtimeSignals: {
      gcEvents: [],
      eventLoopSamples: [],
      eventLoopAvailable: false,
    },
    kinds: {
      test: {},
    },
  };
}

describe('profile API', () => {
  beforeEach(() => {
    mocks.runCapture.mockResolvedValue(makeBundle());
    mocks.buildLanternaReport.mockReturnValue({
      meta: {},
      profiles: {},
      findings: [],
    });
    mocks.runCapture.mockClear();
    mocks.buildLanternaReport.mockClear();
  });

  it('runProfile captures a spawned target and builds a report through injected analyzers', async () => {
    const report = await runProfile({
      command: ['node', 'app.js'],
      pretty: false,
      deep: true,
      sampleIntervalMicros: 1000,
      kinds: [testKind],
      extraAnalyzers: [testFinding],
    });

    expect(report).toEqual({ meta: {}, profiles: {}, findings: [] });
    expect(mocks.runCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: [testKind],
        sourceOptions: expect.objectContaining({
          command: ['node', 'app.js'],
          deep: true,
        }),
      }),
    );
    expect(mocks.buildLanternaReport).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        profiles: { test: { ok: true } },
        findings: [expect.objectContaining({ id: 'test.finding' })],
      }),
      [testKind],
      expect.objectContaining({ mode: 'spawn' }),
    );
  });

  it('attachProfile captures an inspector target and builds an attach-mode report', async () => {
    await attachProfile({
      pid: 1234,
      pretty: false,
      sampleIntervalMicros: 1000,
      kinds: [testKind],
    });

    expect(mocks.runCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: [testKind],
        sourceOptions: expect.objectContaining({
          pid: 1234,
        }),
      }),
    );
    expect(mocks.buildLanternaReport).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        profiles: { test: { ok: true } },
      }),
      [testKind],
      expect.objectContaining({ mode: 'attach' }),
    );
  });
});
