import {
  type CpuKindData,
  type CpuKindOptions,
  createCpuProfileKind,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { createBuiltInFindingAnalyzers } from './detectors/index.js';

/**
 * Wraps an already-built CPU {@link ProfileKind} so the built-in detector
 * pack runs by default. Composable form for callers who already hold a kind.
 */
export function withBuiltInCpuDetectors(kind: ProfileKind<CpuKindData>): ProfileKind<CpuKindData> {
  return { ...kind, builtInAnalyzers: createBuiltInFindingAnalyzers() };
}

/**
 * One-shot factory: builds a CPU {@link ProfileKind} pre-wired with the
 * built-in detector pack. Drivers (CLI, programmatic users) should prefer
 * this over composing `withBuiltInCpuDetectors(createCpuProfileKind(...))`
 * manually so the kind id → detectors mapping lives in one place.
 */
export function createCpuProfileKindWithBuiltInDetectors(
  options: CpuKindOptions,
): ProfileKind<CpuKindData> {
  return withBuiltInCpuDetectors(createCpuProfileKind(options));
}
