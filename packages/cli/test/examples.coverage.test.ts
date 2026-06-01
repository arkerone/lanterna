// Coverage meta-test: keeps the example suite honest over time.
//
// It reads the REAL built-in detector registry and asserts that every detector
// id is exercised by at least one example in the shared manifest — so adding a
// new built-in detector without a matching example fails this test. It also
// guards the other direction (no example claims a finding that no detector can
// emit). This test does no profiling, so it runs in the normal `npm test`.

import {
  defaultAsyncDetectors,
  defaultDetectors,
  defaultMemoryDetectors,
} from '@lanterna-profiler/detectors';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, FIXED_EXAMPLES } from '../../../examples/manifest.mjs';

interface ExampleSpec {
  dir: string;
  expect: string[];
}
interface FixedSpec {
  dir: string;
  forbid: string[];
}

const BUILTIN_DETECTOR_IDS = [
  ...defaultDetectors,
  ...defaultMemoryDetectors,
  ...defaultAsyncDetectors,
].map((detector) => detector.id);

const positives = EXAMPLES as ExampleSpec[];
const negatives = FIXED_EXAMPLES as FixedSpec[];

const expectedStems = new Set(positives.flatMap((spec) => spec.expect));
const forbiddenStems = new Set(negatives.flatMap((spec) => spec.forbid));

describe('example suite covers every built-in detector', () => {
  it('registers exactly 19 built-in detectors (sanity)', () => {
    expect(new Set(BUILTIN_DETECTOR_IDS).size).toBe(19);
  });

  it.each(BUILTIN_DETECTOR_IDS)('%s is covered by an example', (detectorId) => {
    expect(
      expectedStems.has(detectorId),
      `no example in examples/manifest.mjs expects "${detectorId}" — add one and wire it into the manifest`,
    ).toBe(true);
  });

  it('every expected/forbidden stem maps to a real detector id (no typos)', () => {
    const known = new Set(BUILTIN_DETECTOR_IDS);
    const unknownExpected = [...expectedStems].filter((stem) => !known.has(stem));
    const unknownForbidden = [...forbiddenStems].filter((stem) => !known.has(stem));
    expect(unknownExpected, 'expect stems with no matching detector').toEqual([]);
    expect(unknownForbidden, 'forbid stems with no matching detector').toEqual([]);
  });
});
