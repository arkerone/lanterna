import {
  BEST_EFFORT_DETECTOR_IDS,
  detectorReliabilityTier,
  findingBaseId,
  isBestEffortFinding,
} from '@lanterna-profiler/detectors';
import { describe, expect, it } from 'vitest';

describe('detector reliability tier', () => {
  it('extracts the base id from a suffixed finding id', () => {
    expect(findingBaseId('cpu-hotspot:foo')).toBe('cpu-hotspot');
    expect(findingBaseId('deopt-loop:Module.bar')).toBe('deopt-loop');
    expect(findingBaseId('orphan-async-resource')).toBe('orphan-async-resource');
  });

  it('classifies best-effort detectors regardless of suffix', () => {
    for (const id of BEST_EFFORT_DETECTOR_IDS) {
      expect(detectorReliabilityTier(`${id}:something`)).toBe('best-effort');
      expect(isBestEffortFinding(`${id}:something`)).toBe(true);
      expect(isBestEffortFinding(id)).toBe(true);
    }
  });

  it('classifies everything else as standard', () => {
    for (const id of ['cpu-hotspot:foo', 'memory-growth:rss', 'long-await:7', 'excessive-gc']) {
      expect(detectorReliabilityTier(id)).toBe('standard');
      expect(isBestEffortFinding(id)).toBe(false);
    }
  });
});
