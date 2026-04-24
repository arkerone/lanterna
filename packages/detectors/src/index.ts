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
  resolveAttribution,
} from './detectors/shared.js';
export type { CpuDetectorReport, Detector, FindingContext } from './detectors/types.js';
export * as extensionApi from './extension-api.js';
export type {
  LanternaDetectorPlugin,
  LanternaPluginContext,
} from './plugin.js';
export { buildFindingContext, createFindingAnalyzerFromDetector } from './plugin.js';
