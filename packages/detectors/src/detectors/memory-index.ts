import {
  createFindingAnalyzerFromKindScopedDetector,
  type FindingAnalyzer,
  type KindScopedDetector,
  type ProfileSectionMap,
} from '@lanterna-profiler/core';
import { allocInHotPathDetector } from './alloc-in-hot-path.js';
import { externalBufferPressureDetector } from './external-buffer-pressure.js';
import { largeAllocatorDetector } from './large-allocator.js';
import { memoryGrowthDetector } from './memory-growth.js';

/**
 * Memory-scoped detectors. `alloc-in-hot-path` is multi-kind (`cpu` + `memory`)
 * and is intentionally listed here so it ships with the memory pack — the
 * runtime wrapper auto-skips it when `cpu` is absent from the capture.
 */
export const MEMORY_DETECTORS: ReadonlyArray<KindScopedDetector<keyof ProfileSectionMap>> = [
  memoryGrowthDetector,
  largeAllocatorDetector,
  externalBufferPressureDetector,
  allocInHotPathDetector,
];

export function createBuiltInMemoryFindingAnalyzers(): FindingAnalyzer[] {
  return MEMORY_DETECTORS.map((d) => createFindingAnalyzerFromKindScopedDetector(d));
}
