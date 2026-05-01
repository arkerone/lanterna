import {
  createFindingAnalyzerFromKindScopedDetector,
  type FindingAnalyzer,
  type KindScopedDetector,
  type ProfileSectionMap,
} from '@lanterna-profiler/core';
import { deepAsyncChainDetector } from './deep-async-chain.js';
import { hotAsyncContextDetector } from './hot-async-context.js';
import { longAwaitDetector } from './long-await.js';
import { microtaskFloodDetector } from './microtask-flood.js';
import { orphanAsyncResourceDetector } from './orphan-async-resource.js';

/**
 * Async-scoped detectors. `hot-async-context` is multi-kind (`cpu` + `async`)
 * and auto-skipped when CPU isn't captured — same shape as `alloc-in-hot-path`
 * in the memory pack.
 */
export const ASYNC_DETECTORS: ReadonlyArray<KindScopedDetector<keyof ProfileSectionMap>> = [
  longAwaitDetector,
  orphanAsyncResourceDetector,
  deepAsyncChainDetector,
  microtaskFloodDetector,
  hotAsyncContextDetector,
];

export function createBuiltInAsyncFindingAnalyzers(): FindingAnalyzer[] {
  return ASYNC_DETECTORS.map((d) => createFindingAnalyzerFromKindScopedDetector(d));
}
