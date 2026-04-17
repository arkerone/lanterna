import { buildLanternaReport } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import {
  createDefaultAnalysisPipeline,
  createFindingAnalyzerFromDetector,
  type Detector,
} from '../src/index.js';
import { loadProfile, makeRaw } from './helpers.js';

const defaultOptions = {
  sampleIntervalMicros: 1000,
  deep: false,
  command: ['node', 'app.js'],
};

const alwaysDetector: Detector = {
  id: 'custom-test:always',
  detect() {
    return [
      {
        id: 'custom-test:always',
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
  it('createFindingAnalyzerFromDetector exposes detector output through the pipeline', () => {
    const raw = makeRaw(loadProfile('sync-crypto'));
    const pipeline = createDefaultAnalysisPipeline();
    pipeline.register(createFindingAnalyzerFromDetector(alwaysDetector));

    const report = buildLanternaReport(raw, pipeline.run(raw, defaultOptions), defaultOptions);
    expect(report.findings.some((f) => f.id === 'custom-test:always')).toBe(true);
  });

  it('preserves detector id and order', () => {
    const orderedDetector: Detector = { ...alwaysDetector, order: 42 };
    const analyzer = createFindingAnalyzerFromDetector(orderedDetector);
    expect(analyzer.id).toBe('custom-test:always');
    expect(analyzer.order).toBe(42);
  });
});
