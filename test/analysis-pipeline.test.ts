import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCapture,
  createDefaultAnalysisPipeline,
  defineFindingAnalyzer,
  defineSectionAnalyzer,
} from '../src/analysis/index.js';
import { buildLanternaReport } from '../src/report/index.js';
import { serializeReport } from '../src/report/serialize.js';
import { loadProfile, makeRaw } from './helpers.js';

describe('analysis pipeline', () => {
  it('default pipeline matches analyzeCapture() + buildLanternaReport()', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const options = {
      sampleIntervalMicros: 1000,
      deep: false,
      command: ['node', 'app.js'],
    };
    const expected = buildLanternaReport(raw, analyzeCapture(raw, options), options);
    const actual = buildLanternaReport(raw, createDefaultAnalysisPipeline().run(raw, options), options);

    assert.deepEqual(actual, expected);
  });

  it('allows extension sections and findings to be registered programmatically', () => {
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

    const options = {
      sampleIntervalMicros: 1000,
      deep: false,
      command: ['node', 'app.js'],
    };
    const report = buildLanternaReport(raw, pipeline.run(raw, options), options);

    assert.deepEqual(report.extensions?.['acme.top-hotspot'], {
      topHotspot: 'pbkdf2Sync',
      hotspotCount: report.hotspots.length,
    });
    assert.ok(report.findings.some((finding) => finding.id === 'acme.extension-finding'));
    assert.doesNotThrow(() => serializeReport(report, { pretty: false }));
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

    assert.throws(
      () => pipeline.register(defineSectionAnalyzer({
        id: 'acme.second',
        kind: 'section',
        namespace: 'acme.shared',
        run() {
          return { ok: false };
        },
      })),
      /duplicate section namespace/,
    );
  });

  it('rejects invalid built-in evidence extras at serialization time', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const options = {
      sampleIntervalMicros: 1000,
      deep: false,
      command: ['node', 'app.js'],
    };
    const report = buildLanternaReport(raw, createDefaultAnalysisPipeline().run(raw, options), options);

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

    assert.throws(
      () => serializeReport(report, { pretty: false }),
      /invalid lanterna report/,
    );
  });
});
