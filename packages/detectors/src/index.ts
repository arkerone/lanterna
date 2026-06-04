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
export { deepAsyncChainDetector } from './detectors/async/deep-async-chain.js';
export { hotAsyncContextDetector } from './detectors/async/hot-async-context.js';
export {
  ASYNC_DETECTORS as defaultAsyncDetectors,
  createBuiltInAsyncFindingAnalyzers,
} from './detectors/async/index.js';
export { longAwaitDetector } from './detectors/async/long-await.js';
export { microtaskFloodDetector } from './detectors/async/microtask-flood.js';
export { orphanAsyncResourceDetector } from './detectors/async/orphan-async-resource.js';
export { cpuHotspotDetector } from './detectors/cpu/cpu-hotspot.js';
export {
  createBuiltInFindingAnalyzers,
  DETECTORS as defaultDetectors,
} from './detectors/cpu/index.js';
export { allocInHotPathDetector } from './detectors/memory/alloc-in-hot-path.js';
export { externalBufferPressureDetector } from './detectors/memory/external-buffer-pressure.js';
export {
  createBuiltInMemoryFindingAnalyzers,
  MEMORY_DETECTORS as defaultMemoryDetectors,
} from './detectors/memory/index.js';
export { largeAllocatorDetector } from './detectors/memory/large-allocator.js';
export { memoryGrowthDetector } from './detectors/memory/memory-growth.js';
export {
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  resolveAttribution,
} from './detectors/shared/attribution.js';
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
