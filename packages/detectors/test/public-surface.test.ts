import * as detectors from '@lanterna-profiler/detectors';
import { describe, expect, it } from 'vitest';

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
        withBuiltInCpuDetectors: expect.any(Function),
      }),
    );
  });
});
