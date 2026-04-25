import {
  buildLanternaReport,
  createAnalysisPipeline,
  createCpuProfileKind,
  defineFindingAnalyzer,
  defineProfileKind,
  defineSectionAnalyzer,
  serializeReport,
} from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { analyzeCapture, createDefaultAnalysisPipeline } from '../src/index.js';
import { loadProfile, makeRaw } from './helpers.js';

const cpuKinds = [createCpuProfileKind({ readStderrSoFar: () => '' })];

const defaultOptions = {
  sampleIntervalMicros: 1000,
  deep: false,
  command: ['node', 'app.js'],
};

describe('analysis pipeline', () => {
  it('produces the same report through the default pipeline and the high-level helper', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));

    const directReport = buildLanternaReport(
      raw,
      analyzeCapture(raw, defaultOptions, cpuKinds),
      cpuKinds,
      defaultOptions,
    );
    const pipelineReport = buildLanternaReport(
      raw,
      createDefaultAnalysisPipeline(cpuKinds).run(raw, defaultOptions),
      cpuKinds,
      defaultOptions,
    );

    expect(pipelineReport).toEqual(directReport);
  });

  it('supports custom sections and findings that flow through report serialization', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const pipeline = createDefaultAnalysisPipeline(cpuKinds);

    pipeline.register(
      defineSectionAnalyzer({
        id: 'acme.top-hotspot',
        kind: 'section',
        namespace: 'acme.top-hotspot',
        run(_context, snapshot) {
          const cpu = snapshot.profiles.cpu;
          return {
            topHotspot: cpu?.hotspots[0]?.function ?? null,
            hotspotCount: cpu?.hotspots.length ?? 0,
          };
        },
      }),
    );

    pipeline.register(
      defineFindingAnalyzer({
        id: 'acme.extension-finding',
        kind: 'finding',
        run(_context, snapshot) {
          const extension = snapshot.extensions['acme.top-hotspot'] as {
            topHotspot: string | null;
            hotspotCount: number;
          };

          if (!extension?.topHotspot) return [];

          return [
            {
              id: 'acme.extension-finding',
              profileKind: 'cpu',
              severity: 'info',
              category: 'acme.extension-finding',
              title: 'Extension-derived hotspot summary',
              evidence: {
                file: 'extensions',
                line: 0,
                function: extension.topHotspot,
                selfPct: 0,
                extra: { hotspotCount: extension.hotspotCount },
              },
              why: 'Custom extension synthesized an additional summary.',
              suggestion: 'Inspect extension output for follow-up automation.',
              references: [],
            },
          ];
        },
      }),
    );

    const report = buildLanternaReport(
      raw,
      pipeline.run(raw, defaultOptions),
      cpuKinds,
      defaultOptions,
    );

    expect(report.extensions?.['acme.top-hotspot']).toEqual({
      topHotspot: 'pbkdf2Sync',
      hotspotCount: report.profiles.cpu?.hotspots.length ?? 0,
    });
    expect(report.findings).toContainEqual(
      expect.objectContaining({ id: 'acme.extension-finding' }),
    );
    expect(() => serializeReport(report, { pretty: false, kinds: cpuKinds })).not.toThrow();
  });

  it('rejects duplicate extension namespaces', () => {
    const pipeline = createDefaultAnalysisPipeline(cpuKinds);

    pipeline.register(
      defineSectionAnalyzer({
        id: 'acme.first',
        kind: 'section',
        namespace: 'acme.shared',
        run() {
          return { ok: true };
        },
      }),
    );

    expect(() =>
      pipeline.register(
        defineSectionAnalyzer({
          id: 'acme.second',
          kind: 'section',
          namespace: 'acme.shared',
          run() {
            return { ok: false };
          },
        }),
      ),
    ).toThrow(/duplicate section namespace/);
  });

  it('rejects duplicate finding analyzer ids', () => {
    const pipeline = createDefaultAnalysisPipeline(cpuKinds);
    const analyzer = defineFindingAnalyzer({
      id: 'acme.duplicate',
      kind: 'finding',
      run() {
        return [];
      },
    });

    pipeline.register(analyzer);

    expect(() => pipeline.register(analyzer)).toThrow(/duplicate finding analyzer id/);
  });

  it('rejects duplicate profile kind ids', () => {
    const kind = defineProfileKind({
      id: 'duplicate',
      reportSectionKey: 'duplicate',
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

    expect(() => createAnalysisPipeline({ kinds: [kind, kind] })).toThrow(
      /duplicate profile kind id/,
    );
  });

  it('fails serialization when builtin finding evidence contains unsupported extras', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const report = buildLanternaReport(
      raw,
      createDefaultAnalysisPipeline(cpuKinds).run(raw, defaultOptions),
      cpuKinds,
      defaultOptions,
    );

    report.findings.push({
      id: 'broken-sync-crypto',
      profileKind: 'cpu',
      severity: 'warning',
      category: 'sync-crypto',
      title: 'Broken finding',
      evidence: {
        file: '/tmp/example.js',
        line: 1,
        function: 'handler',
        selfPct: 1,
        extra: { hotspotCount: 1 },
      },
      why: 'Broken on purpose.',
      suggestion: 'Do not do this.',
      references: [],
    });

    expect(() => serializeReport(report, { pretty: false, kinds: cpuKinds })).toThrow(
      /invalid lanterna report/,
    );
  });

  it('records diagnostics for non-fatal analyzer failures', () => {
    const raw = makeRaw(loadProfile('sync-crypto'), {
      kinds: {
        broken: { ok: true },
      },
    });
    const pipeline = createAnalysisPipeline({
      kinds: [
        defineProfileKind({
          id: 'broken',
          reportSectionKey: 'broken',
          reportSchema: z.unknown(),
          createProbe() {
            throw new Error('not used');
          },
          createAnalysisContributor() {
            return {
              analyze() {
                throw new Error('contributor exploded');
              },
            };
          },
          finalize() {
            throw new Error('finalize exploded');
          },
        }),
      ],
      sectionAnalyzers: [
        defineSectionAnalyzer({
          id: 'acme.bad-section',
          kind: 'section',
          namespace: 'acme.bad-section',
          run() {
            throw new Error('section exploded');
          },
        }),
      ],
      findingAnalyzers: [
        defineFindingAnalyzer({
          id: 'acme.bad-finding',
          kind: 'finding',
          run() {
            throw new Error('finding exploded');
          },
        }),
      ],
    });

    expect(() => pipeline.run(raw, defaultOptions)).not.toThrow();
    expect(
      (
        raw.captureIntegrity as {
          diagnostics?: Array<{ stage: string; kindId?: string; analyzerId?: string }>;
        }
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({ stage: 'analysis-contributor', kindId: 'broken' }),
      expect.objectContaining({ stage: 'section-analyzer', analyzerId: 'acme.bad-section' }),
      expect.objectContaining({ stage: 'finding-analyzer', analyzerId: 'acme.bad-finding' }),
      expect.objectContaining({ stage: 'finalize', kindId: 'broken' }),
    ]);
  });
});
