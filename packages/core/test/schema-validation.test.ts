import { describe, expect, it } from 'vitest';
import { lanternaReportSchema } from '../src/report/schema.js';
import type { LanternaReport } from '../src/report/types.js';

// ---------------------------------------------------------------------------
// Minimal valid report fixture
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<LanternaReport> = {}): unknown {
  const base: LanternaReport = {
    meta: {
      schemaVersion: '1.0.0',
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      pid: 1234,
      startedAt: '2024-01-01T00:00:00.000Z',
      durationMs: 5000,
      sampleIntervalMicros: 1000,
      totalSamples: 200,
      cwd: '/app',
      command: ['node', 'server.js'],
      lanternaVersion: '0.1.0',
      mode: 'spawn',
      deep: false,
      captureIntegrity: {
        controlChannel: true,
        controlChannelExpected: true,
        eventLoopTimed: false,
        gcTimed: false,
        cpuSamplesTimed: true,
        gcObserverAvailable: true,
      },
    },
    summary: {
      totalCpuMs: 5000,
      onCpuRatio: 0.6,
      userCodeRatio: 0.4,
      nodeModulesRatio: 0.1,
      builtinRatio: 0.05,
      nativeRatio: 0.02,
      gcRatio: 0.03,
      idleRatio: 0.4,
      topCategory: 'user',
      dominantBlockingKind: null,
    },
    hotspots: [],
    hotStacks: [],
    gc: {
      totalPauseMs: 50,
      count: { scavenge: 3, markSweep: 1, incremental: 0, other: 0 },
      longestPauseMs: 20,
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
    deopts: [],
    findings: [],
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lanternaReportSchema', () => {
  describe('valid reports', () => {
    it('accepts a minimal valid report', () => {
      const result = lanternaReportSchema.safeParse(makeReport());
      expect(result.success).toBe(true);
    });

    it('accepts optional extensions field', () => {
      const result = lanternaReportSchema.safeParse(
        makeReport({ extensions: { myPlugin: { score: 42 } } }),
      );
      expect(result.success).toBe(true);
    });

    it('accepts a report with a custom (extension) finding', () => {
      const report = makeReport({
        findings: [
          {
            id: 'custom:thing',
            severity: 'warning',
            category: 'my-custom-category',
            title: 'Custom finding',
            evidence: { file: '/app/foo.ts', line: 10, function: 'doThing', selfPct: 5 },
            why: 'Because.',
            suggestion: 'Fix it.',
            references: [],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(true);
    });

    it('accepts a blocking-io finding with correct extra', () => {
      const report = makeReport({
        findings: [
          {
            id: 'blocking-io:fs.readFileSync',
            severity: 'warning',
            category: 'blocking-io',
            title: 'Blocking I/O (fs.readFileSync)',
            evidence: {
              file: '/app/handler.ts',
              line: 42,
              function: 'readConfig',
              selfPct: 8,
              extra: {
                api: 'fs.readFileSync',
                callee: 'readFileSync',
                proofLevel: 'direct-builtin',
                attributionBasis: 'builtin-only',
                attributionConfidence: 'low',
              },
            },
            why: 'Blocks the event loop.',
            suggestion: 'Use fs/promises.',
            references: [],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(true);
    });
  });

  describe('missing required fields', () => {
    it('rejects a report with missing meta', () => {
      const { meta: _meta, ...withoutMeta } = makeReport() as LanternaReport;
      const result = lanternaReportSchema.safeParse(withoutMeta);
      expect(result.success).toBe(false);
    });

    it('rejects a report with missing findings array', () => {
      const { findings: _findings, ...withoutFindings } = makeReport() as LanternaReport;
      const result = lanternaReportSchema.safeParse(withoutFindings);
      expect(result.success).toBe(false);
    });

    it('rejects a report with missing gc section', () => {
      const { gc: _gc, ...withoutGc } = makeReport() as LanternaReport;
      const result = lanternaReportSchema.safeParse(withoutGc);
      expect(result.success).toBe(false);
    });
  });

  describe('wrong types', () => {
    it('rejects non-integer pid', () => {
      const report = makeReport();
      (report as Record<string, unknown>).meta = {
        ...(report as LanternaReport).meta,
        pid: 12.5,
      };
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it('rejects invalid severity value', () => {
      const report = makeReport({
        findings: [
          {
            id: 'x',
            severity: 'fatal' as 'critical',
            category: 'custom',
            title: 'X',
            evidence: { file: '/app/x.ts', line: 1, function: 'x', selfPct: 1 },
            why: 'why',
            suggestion: 'fix',
            references: [],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it('rejects invalid mode value', () => {
      const report = makeReport();
      (report as Record<string, unknown>).meta = {
        ...(report as LanternaReport).meta,
        mode: 'unknown-mode',
      };
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it('rejects non-finite number in summary', () => {
      const report = makeReport({
        summary: {
          ...(makeReport() as LanternaReport).summary,
          totalCpuMs: Infinity,
        },
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });
  });

  describe('finding evidence validation', () => {
    it('rejects a blocking-io finding with missing api field in extra', () => {
      const report = makeReport({
        findings: [
          {
            id: 'blocking-io:fs.readFileSync',
            severity: 'warning',
            category: 'blocking-io',
            title: 'Blocking I/O',
            evidence: {
              file: '/app/handler.ts',
              line: 42,
              function: 'readConfig',
              selfPct: 8,
              extra: {
                // Missing `api` field
                callee: 'readFileSync',
                proofLevel: 'direct-builtin',
                attributionBasis: 'builtin-only',
                attributionConfidence: 'low',
              },
            },
            why: 'Blocks.',
            suggestion: 'Fix.',
            references: [],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });

    it('accepts a custom finding with non-object extra as plain object', () => {
      const report = makeReport({
        findings: [
          {
            id: 'custom:x',
            severity: 'info',
            category: 'my-plugin',
            title: 'Plugin finding',
            evidence: {
              file: '/app/x.ts',
              line: 1,
              function: 'x',
              selfPct: 1,
              extra: { pluginData: 'value', score: 99 },
            },
            why: 'Plugin detected an issue.',
            suggestion: 'Fix the issue.',
            references: ['https://example.com'],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(true);
    });

    it('rejects a custom finding with extra as an array', () => {
      const report = makeReport({
        findings: [
          {
            id: 'custom:x',
            severity: 'info',
            category: 'my-plugin',
            title: 'Plugin finding',
            evidence: {
              file: '/app/x.ts',
              line: 1,
              function: 'x',
              selfPct: 1,
              extra: ['not', 'an', 'object'] as unknown as Record<string, unknown>,
            },
            why: 'why',
            suggestion: 'fix',
            references: [],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(false);
    });
  });
});
