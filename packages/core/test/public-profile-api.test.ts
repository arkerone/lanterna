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
});
