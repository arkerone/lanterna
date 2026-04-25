import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnalysisPipeline } from '../src/analysis/core/pipeline.js';
import { createKindRegistry } from '../src/kinds/core/registry.js';
import { defineProfileKind, type ProfileKind } from '../src/kinds/core/types.js';
import { buildReportSchema } from '../src/report/schema.js';

function kind(id: string, reportSectionKey = id): ProfileKind {
  return defineProfileKind({
    id,
    reportSectionKey,
    reportSchema: z.unknown(),
    createProbe() {
      return {
        start: async () => {},
        stop: async () => ({}),
      };
    },
    createAnalysisContributor() {
      return {
        analyze() {},
      };
    },
  });
}

describe('profile kind identity', () => {
  it('rejects duplicate report section keys in the analysis pipeline', () => {
    expect(() =>
      createAnalysisPipeline({ kinds: [kind('first', 'shared'), kind('second', 'shared')] }),
    ).toThrow(/duplicate profile kind report section key/);
  });

  it('rejects duplicate report section keys in the kind registry', () => {
    expect(() => createKindRegistry([kind('first', 'shared'), kind('second', 'shared')])).toThrow(
      /duplicate profile kind report section key/,
    );
  });

  it('rejects duplicate report section keys in report schema assembly', () => {
    expect(() => buildReportSchema([kind('first', 'shared'), kind('second', 'shared')])).toThrow(
      /duplicate profile kind report section key/,
    );
  });

  it('builds a schema with two distinct dynamic profile sections', () => {
    const schema = buildReportSchema([
      { reportSectionKey: 'alpha', reportSchema: z.object({ a: z.literal(true) }) },
      { reportSectionKey: 'beta', reportSchema: z.object({ b: z.literal(true) }) },
    ]);

    const result = schema.safeParse({
      meta: {
        schemaVersion: '2.0.0',
        nodeVersion: 'v24.0.0',
        v8Version: '12.0.0',
        platform: 'linux',
        arch: 'x64',
        pid: 1234,
        startedAt: '2024-01-01T00:00:00.000Z',
        durationMs: 100,
        sampleIntervalMicros: 1000,
        cwd: '/app',
        command: ['node', 'app.js'],
        lanternaVersion: '0.1.0',
        mode: 'spawn',
        deep: false,
        profileKinds: ['alpha', 'beta'],
        kinds: {},
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
      },
      profiles: {
        alpha: { a: true },
        beta: { b: true },
      },
      findings: [],
    });

    expect(result.success).toBe(true);
  });
});
