import { describe, expect, it } from 'vitest';
import {
  analyzeCapture,
  createDefaultAnalysisPipeline,
  defineFindingAnalyzer,
  defineSectionAnalyzer,
} from '../src/analysis/index.js';
import { buildLanternaReport } from '../src/report/index.js';
import { serializeReport } from '../src/report/serialize.js';
import { loadProfile, makeRaw } from './helpers.js';

const defaultOptions = {
  sampleIntervalMicros: 1000,
  deep: false,
  command: ['node', 'app.js'],
};

describe('analysis pipeline', () => {
  it('produces the same report through the default pipeline and the high-level helper', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));

    const directReport = buildLanternaReport(raw, analyzeCapture(raw, defaultOptions), defaultOptions);
    const pipelineReport = buildLanternaReport(raw, createDefaultAnalysisPipeline().run(raw, defaultOptions), defaultOptions);

    expect(pipelineReport).toEqual(directReport);
  });

  it('supports custom sections and findings that flow through report serialization', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const pipeline = createDefaultAnalysisPipeline();

    pipeline.register(defineSectionAnalyzer({
      id: 'acme.top-hotspot',
      kind: 'section',
      namespace: 'acme.top-hotspot',
      run(_context, snapshot) {
        return {
          topHotspot: snapshot.hotspots[0]?.function ?? null,
          hotspotCount: snapshot.hotspots.length,
        };
      },
    }));

    pipeline.register(defineFindingAnalyzer({
      id: 'acme.extension-finding',
      kind: 'finding',
      run(_context, snapshot) {
        const extension = snapshot.extensions['acme.top-hotspot'] as {
          topHotspot: string | null;
          hotspotCount: number;
        };

        if (!extension?.topHotspot) return [];

        return [{
          id: 'acme.extension-finding',
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
        }];
      },
    }));

    const report = buildLanternaReport(raw, pipeline.run(raw, defaultOptions), defaultOptions);

    expect(report.extensions?.['acme.top-hotspot']).toEqual({
      topHotspot: 'pbkdf2Sync',
      hotspotCount: report.hotspots.length,
    });
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'acme.extension-finding' }));
    expect(() => serializeReport(report, { pretty: false })).not.toThrow();
  });

  it('rejects duplicate extension namespaces', () => {
    const pipeline = createDefaultAnalysisPipeline();

    pipeline.register(defineSectionAnalyzer({
      id: 'acme.first',
      kind: 'section',
      namespace: 'acme.shared',
      run() {
        return { ok: true };
      },
    }));

    expect(() => pipeline.register(defineSectionAnalyzer({
      id: 'acme.second',
      kind: 'section',
      namespace: 'acme.shared',
      run() {
        return { ok: false };
      },
    }))).toThrow(/duplicate section namespace/);
  });

  it('fails serialization when builtin finding evidence contains unsupported extras', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const report = buildLanternaReport(raw, createDefaultAnalysisPipeline().run(raw, defaultOptions), defaultOptions);

    report.findings.push({
      id: 'broken-sync-crypto',
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

    expect(() => serializeReport(report, { pretty: false })).toThrow(/invalid lanterna report/);
  });
});
