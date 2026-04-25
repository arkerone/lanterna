import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnalysisPipeline } from '../src/analysis/core/pipeline.js';
import { createFindingAnalyzerFromKindScopedDetector } from '../src/analysis/kind-scoped-detector.js';
import { createCaptureIntegrity } from '../src/capture/core/session.js';
import type { KindScopedDetector } from '../src/index.js';
import { defineProfileKind } from '../src/kinds/core/types.js';

describe('kind-scoped detector adapter', () => {
  it('resolves report sections through the registered profile kind', () => {
    const kind = defineProfileKind({
      id: 'custom-kind',
      reportSectionKey: 'custom_report',
      reportSchema: z.object({ value: z.number() }),
      createProbe() {
        return {
          start: async () => {},
          stop: async () => ({ value: 42 }),
        };
      },
      createAnalysisContributor() {
        return {
          analyze(context) {
            context.writeSection({ value: context.data.value });
            context.setContextView({ label: 'from-view' });
          },
        };
      },
    });

    const detector: KindScopedDetector<'custom-kind'> = {
      id: 'custom.detector',
      kindIds: ['custom-kind'],
      detect(kinds) {
        expect(kinds['custom-kind'].report).toEqual({ value: 42 });
        expect(kinds['custom-kind'].view).toEqual({ label: 'from-view' });
        return [
          {
            id: 'custom.detector',
            severity: 'info',
            category: 'custom',
            title: 'Custom detector',
            evidence: {
              file: 'custom.js',
              line: 1,
              function: 'handler',
              selfPct: 0,
            },
            why: 'Exercises custom kind section lookup.',
            suggestion: 'No action required.',
            references: [],
          },
        ];
      },
    };

    const pipeline = createAnalysisPipeline({
      kinds: [kind],
      findingAnalyzers: [createFindingAnalyzerFromKindScopedDetector(detector)],
    });

    const result = pipeline.run(
      {
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
          'custom-kind': { value: 42 },
        },
      },
      { command: ['node', 'app.js'] },
    );

    expect(result.profiles).toEqual({ custom_report: { value: 42 } });
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: 'custom.detector',
        profileKind: 'custom-kind',
      }),
    ]);
  });
});
