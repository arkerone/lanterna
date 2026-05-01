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
export {
  ASYNC_DETECTORS as defaultAsyncDetectors,
  createBuiltInAsyncFindingAnalyzers,
} from './detectors/async-index.js';
export { deepAsyncChainDetector } from './detectors/deep-async-chain.js';
export { externalBufferPressureDetector } from './detectors/external-buffer-pressure.js';
export { hotAsyncContextDetector } from './detectors/hot-async-context.js';
export {
  createBuiltInFindingAnalyzers,
  DETECTORS as defaultDetectors,
} from './detectors/index.js';
export { largeAllocatorDetector } from './detectors/large-allocator.js';
export { longAwaitDetector } from './detectors/long-await.js';
export { memoryGrowthDetector } from './detectors/memory-growth.js';
export {
  createBuiltInMemoryFindingAnalyzers,
  MEMORY_DETECTORS as defaultMemoryDetectors,
} from './detectors/memory-index.js';
export { microtaskFloodDetector } from './detectors/microtask-flood.js';
export { orphanAsyncResourceDetector } from './detectors/orphan-async-resource.js';
export {
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  resolveAttribution,
} from './detectors/shared.js';
export * as extensionApi from './extension-api.js';
export {
  createAsyncProfileKindWithBuiltInDetectors,
  withBuiltInAsyncDetectors,
} from './with-built-in-async-detectors.js';
export {
  createCpuProfileKindWithBuiltInDetectors,
  withBuiltInCpuDetectors,
} from './with-built-in-cpu-detectors.js';
export {
  createMemoryProfileKindWithBuiltInDetectors,
  withBuiltInMemoryDetectors,
} from './with-built-in-memory-detectors.js';
