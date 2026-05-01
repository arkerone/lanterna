import {
  type AsyncKindData,
  type AsyncKindOptions,
  createAsyncProfileKind,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { createBuiltInAsyncFindingAnalyzers } from './detectors/async-index.js';

/**
 * Wraps an already-built async {@link ProfileKind} so the built-in async
 * detector pack runs by default.
 */
export function withBuiltInAsyncDetectors(
  kind: ProfileKind<AsyncKindData>,
): ProfileKind<AsyncKindData> {
  return { ...kind, builtInAnalyzers: createBuiltInAsyncFindingAnalyzers() };
}

/**
 * One-shot factory: builds an async {@link ProfileKind} pre-wired with the
 * built-in detector pack.
 */
export function createAsyncProfileKindWithBuiltInDetectors(
  options: AsyncKindOptions = {},
): ProfileKind<AsyncKindData> {
  return withBuiltInAsyncDetectors(createAsyncProfileKind(options));
}
