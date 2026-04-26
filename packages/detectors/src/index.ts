export type {
  ProfilePipelinePlugin as LanternaDetectorPlugin,
  ProfilePluginContext as LanternaPluginContext,
} from '@lanterna-profiler/core';
export { analyzeCapture, createDefaultAnalysisPipeline } from './analyze-capture.js';
export type {
  BlockingThresholds,
  DetectorThresholds,
  EventLoopThresholds,
  GcThresholds,
} from './config.js';
export { DETECTOR_THRESHOLDS } from './config.js';
export { allocInHotPathDetector } from './detectors/alloc-in-hot-path.js';
export { externalBufferPressureDetector } from './detectors/external-buffer-pressure.js';
export {
  createBuiltInFindingAnalyzers,
  DETECTORS as defaultDetectors,
} from './detectors/index.js';
export { largeAllocatorDetector } from './detectors/large-allocator.js';
export { memoryGrowthDetector } from './detectors/memory-growth.js';
export {
  createBuiltInMemoryFindingAnalyzers,
  MEMORY_DETECTORS as defaultMemoryDetectors,
} from './detectors/memory-index.js';
export {
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  resolveAttribution,
} from './detectors/shared.js';
export * as extensionApi from './extension-api.js';
export {
  createCpuProfileKindWithBuiltInDetectors,
  withBuiltInCpuDetectors,
} from './with-built-in-cpu-detectors.js';
export {
  createMemoryProfileKindWithBuiltInDetectors,
  withBuiltInMemoryDetectors,
} from './with-built-in-memory-detectors.js';
