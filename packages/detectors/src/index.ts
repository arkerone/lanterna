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
export {
  createBuiltInFindingAnalyzers,
  DETECTORS as defaultDetectors,
} from './detectors/index.js';
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
