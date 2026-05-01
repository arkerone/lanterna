import * as core from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';

describe('core public profile API', () => {
  it('exposes the application-level profile orchestration API', () => {
    expect(core).toEqual(
      expect.objectContaining({
        attachProfile: expect.any(Function),
        createDefaultAnalysisPipeline: expect.any(Function),
        createKindRegistry: expect.any(Function),
        runProfile: expect.any(Function),
      }),
    );
  });

  it('keeps extensionApi as the stable plugin author contract', () => {
    expect(core.extensionApi).toEqual(
      expect.objectContaining({
        createAnalysisPipeline: expect.any(Function),
        createDefaultAnalysisPipeline: expect.any(Function),
        defineFindingAnalyzer: expect.any(Function),
        defineProfileKind: expect.any(Function),
        defineSectionAnalyzer: expect.any(Function),
      }),
    );
  });
});
