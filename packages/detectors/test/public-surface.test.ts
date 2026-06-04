import { defineFindingAnalyzer, defineProfileKind } from '@lanterna-profiler/core';
import * as detectors from '@lanterna-profiler/detectors';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('detectors public surface', () => {
  it('does not expose capture orchestration helpers', () => {
    expect(detectors).toEqual(
      expect.not.objectContaining({
        attachProfile: expect.any(Function),
        createDefaultKindRegistry: expect.any(Function),
        runProfile: expect.any(Function),
      }),
    );
  });

  it('keeps the CPU detector factory API available', () => {
    expect(detectors).toEqual(
      expect.objectContaining({
        createBuiltInFindingAnalyzers: expect.any(Function),
        createCpuProfileKindWithBuiltInDetectors: expect.any(Function),
        withBuiltInCpuDetectors: expect.any(Function),
      }),
    );
  });

  it('keeps the memory and async detector factory APIs available', () => {
    expect(detectors).toEqual(
      expect.objectContaining({
        createAsyncProfileKindWithBuiltInDetectors: expect.any(Function),
        createBuiltInAsyncFindingAnalyzers: expect.any(Function),
        createBuiltInMemoryFindingAnalyzers: expect.any(Function),
        createMemoryProfileKindWithBuiltInDetectors: expect.any(Function),
        withBuiltInAsyncDetectors: expect.any(Function),
        withBuiltInMemoryDetectors: expect.any(Function),
      }),
    );
  });

  it('re-exports extensionApi for detector plugin authors', () => {
    expect(detectors.extensionApi).toEqual(
      expect.objectContaining({
        createFindingAnalyzerFromKindScopedDetector: expect.any(Function),
        defineFindingAnalyzer: expect.any(Function),
        defineSectionAnalyzer: expect.any(Function),
      }),
    );
  });

  it('composes built-in detector wrappers with analyzers already carried by a kind', () => {
    const existing = defineFindingAnalyzer({
      id: 'acme.existing',
      kind: 'finding',
      run: () => [],
    });
    const kind = defineProfileKind({
      id: 'cpu',
      reportSectionKey: 'cpu',
      reportSchema: z.unknown(),
      builtInAnalyzers: [existing],
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

    expect(
      detectors.withBuiltInCpuDetectors(kind).builtInAnalyzers?.map((analyzer) => analyzer.id),
    ).toEqual([
      existing.id,
      ...detectors.createBuiltInFindingAnalyzers().map((analyzer) => analyzer.id),
    ]);
  });
});
