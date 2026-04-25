import {
  buildLanternaReport,
  createCpuProfileKind,
  createFindingAnalyzerFromKindScopedDetector,
  type KindScopedDetector,
} from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import { createDefaultAnalysisPipeline } from '../src/index.js';
import { loadProfile, makeRaw } from './helpers.js';

const cpuKinds = [createCpuProfileKind({ readStderrSoFar: () => '' })];

const defaultOptions = {
  sampleIntervalMicros: 1000,
  deep: false,
  command: ['node', 'app.js'],
};

const alwaysDetector: KindScopedDetector<'cpu'> = {
  id: 'custom-test:always',
  kindIds: ['cpu'],
  detect() {
    return [
      {
        id: 'custom-test:always',
        profileKind: 'cpu',
        severity: 'info',
        category: 'custom-test',
        title: 'Custom always-on finding',
        evidence: {
          file: 'plugin-test',
          line: 0,
          function: 'always',
          selfPct: 0,
          extra: { source: 'plugin-test' },
        },
        why: 'Exercises the plugin pipeline.',
        suggestion: 'No action required.',
        references: [],
      },
    ];
  },
};

describe('plugin API', () => {
  it('createFindingAnalyzerFromKindScopedDetector exposes detector output through the pipeline', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const pipeline = createDefaultAnalysisPipeline(cpuKinds);
    pipeline.register(createFindingAnalyzerFromKindScopedDetector(alwaysDetector));

    const report = buildLanternaReport(
      raw,
      pipeline.run(raw, defaultOptions),
      cpuKinds,
      defaultOptions,
    );
    expect(report.findings.some((f) => f.id === 'custom-test:always')).toBe(true);
  });

  it('preserves detector id and order', () => {
    const orderedDetector: KindScopedDetector<'cpu'> = { ...alwaysDetector, order: 42 };
    const analyzer = createFindingAnalyzerFromKindScopedDetector(orderedDetector);
    expect(analyzer.id).toBe('custom-test:always');
    expect(analyzer.order).toBe(42);
  });
});
