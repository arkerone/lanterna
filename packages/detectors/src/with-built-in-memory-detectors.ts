import {
  createMemoryProfileKind,
  type MemoryKindData,
  type MemoryKindOptions,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { createBuiltInMemoryFindingAnalyzers } from './detectors/memory-index.js';

/**
 * Wraps an already-built memory {@link ProfileKind} so the built-in memory
 * detector pack runs by default.
 */
export function withBuiltInMemoryDetectors(
  kind: ProfileKind<MemoryKindData>,
): ProfileKind<MemoryKindData> {
  return { ...kind, builtInAnalyzers: createBuiltInMemoryFindingAnalyzers() };
}

/**
 * One-shot factory: builds a memory {@link ProfileKind} pre-wired with the
 * built-in detector pack.
 */
export function createMemoryProfileKindWithBuiltInDetectors(
  options: MemoryKindOptions,
): ProfileKind<MemoryKindData> {
  return withBuiltInMemoryDetectors(createMemoryProfileKind(options));
}
