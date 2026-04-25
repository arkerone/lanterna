import { describe, expect, it } from 'vitest';
import { createCpuProfileKind } from '../src/kinds/cpu/index.js';
import { LANTERNA_REPORT_SCHEMA_VERSION } from '../src/report/meta.js';
import { buildReportSchema } from '../src/report/schema.js';
import type { CpuProfileReport, LanternaReport } from '../src/report/types.js';

const lanternaReportSchema = buildReportSchema([
  createCpuProfileKind({ readStderrSoFar: () => '' }),
]);

function makeCpuSection(overrides: Partial<CpuProfileReport> = {}): CpuProfileReport {
  return {
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
      topUserHotspot: undefined,
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
    ...overrides,
  };
}

function makeReport(overrides: Partial<LanternaReport> = {}): unknown {
  const base: LanternaReport = {
    meta: {
      schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      pid: 1234,
      startedAt: '2024-01-01T00:00:00.000Z',
      durationMs: 5000,
      sampleIntervalMicros: 1000,
      cwd: '/app',
      command: ['node', 'server.js'],
      lanternaVersion: '0.1.0',
      mode: 'spawn',
      deep: false,
      profileKinds: ['cpu'],
      kinds: { cpu: { samplesTotal: 200 } },
      captureIntegrity: {
        controlChannel: true,
        controlChannelExpected: true,
        eventLoopTimed: false,
        gcTimed: false,
        gcObserverAvailable: true,
        controlChannelWriteErrors: 0,
        gcObserverSetupFailed: 0,
        heartbeatDropped: 0,
        kinds: { cpu: { samplesTimed: true } },
      },
    },
    profiles: { cpu: makeCpuSection() },
    findings: [],
  };
  return { ...base, ...overrides };
}

describe('lanternaReportSchema', () => {
  it('pins the report schema version constant', () => {
    expect(LANTERNA_REPORT_SCHEMA_VERSION).toBe('2.0.0');
  });

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

    it('accepts structured capture diagnostics in meta.captureIntegrity', () => {
      const report = makeReport() as LanternaReport;
      const captureIntegrity = report.meta
        .captureIntegrity as typeof report.meta.captureIntegrity & {
        diagnostics: Array<{ stage: string; message: string; kindId?: string }>;
      };
      captureIntegrity.diagnostics = [
        {
          stage: 'probe-start',
          message: 'cpu start failed',
          kindId: 'cpu',
        },
      ];
      const result = lanternaReportSchema.safeParse(report);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.meta.captureIntegrity.diagnostics).toEqual([
        { stage: 'probe-start', message: 'cpu start failed', kindId: 'cpu' },
      ]);
    });

    it('accepts summary topUserHotspot and finding priority metadata', () => {
      const report = makeReport({
        profiles: {
          cpu: makeCpuSection({
            summary: {
              ...makeCpuSection().summary,
              topUserHotspot: {
                function: 'computeRanking',
                file: 'src/ranking.js',
                line: 27,
                selfPct: 42,
                totalPct: 67,
              },
            },
          }),
        },
        findings: [
          {
            id: 'custom:priority',
            profileKind: 'cpu',
            severity: 'warning',
            category: 'custom',
            title: 'Prioritized finding',
            evidence: { file: '/app/x.ts', line: 1, function: 'x', selfPct: 5 },
            priority: { score: 250, actionConfidence: 'high', impactEstimateMs: 125 },
            why: 'why',
            suggestion: 'fix',
            references: [],
          },
        ],
      });
      const result = lanternaReportSchema.safeParse(report);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.profiles.cpu?.summary.topUserHotspot?.function).toBe('computeRanking');
      expect(result.data.findings[0]?.priority?.score).toBe(250);
    });

    it('accepts a report with a custom (extension) finding', () => {
      const report = makeReport({
        findings: [
          {
            id: 'custom:thing',
            profileKind: 'extension',
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
            profileKind: 'cpu',
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

    it('rejects a report with a malformed cpu profile section', () => {
      const report = makeReport({
        profiles: {
          cpu: { ...makeCpuSection(), gc: undefined as unknown as CpuProfileReport['gc'] },
        },
      });
      const result = lanternaReportSchema.safeParse(report);
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
            profileKind: 'cpu',
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

    it('rejects non-finite number in cpu summary', () => {
      const report = makeReport({
        profiles: {
          cpu: makeCpuSection({
            summary: { ...makeCpuSection().summary, totalCpuMs: Infinity },
          }),
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
            profileKind: 'cpu',
            severity: 'warning',
            category: 'blocking-io',
            title: 'Blocking I/O',
            evidence: {
              file: '/app/handler.ts',
              line: 42,
              function: 'readConfig',
              selfPct: 8,
              extra: {
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
            profileKind: 'extension',
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
            profileKind: 'extension',
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
