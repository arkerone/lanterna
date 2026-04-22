export {
  AnalysisPipeline,
  createAnalysisPipeline,
  defineFindingAnalyzer,
  defineSectionAnalyzer,
  sortFindings,
} from './analysis/core/pipeline.js';
export type {
  AnalysisContext,
  AnalysisOptions,
  AnalysisResult,
  AnalysisSnapshot,
  ExtensionEntry as AnalysisExtensionEntry,
  ExtensionMap,
  FindingAnalyzer,
  SectionAnalyzer,
} from './analysis/core/types.js';
export type { HotspotAttribution } from './analysis/model/hotspots.js';
export { AttachSource, startAttachCapture } from './capture/attach.js';
export type {
  AttachStartOptions,
  CaptureHandle,
  CaptureIntegrity,
  EventLoopHistogram,
  EventLoopSample,
  ProfileSource,
  RawCapture,
  RawCpuProfile,
  RawDeopt,
  RawGcEvent,
  SourceHandle,
  SpawnStartOptions,
  TargetInfo,
} from './capture/core/types.js';
export { SpawnSource, startSpawnCapture } from './capture/spawn.js';
export type { InspectorTargetDescriptor } from './inspector/discovery.js';
export { openInspectorForPid, readInspectableTargetsByPid } from './inspector/discovery.js';
export {
  buildLanternaReport,
  serializeReport,
} from './report/index.js';
export type {
  AlternativeHotspotEvidence,
  AttributionEvidence,
  BaseFinding,
  BlockingIoEvidenceExtra,
  BuiltinFinding,
  BuiltinFindingCategory,
  CpuBoundUserHotspotEvidenceExtra,
  DeoptEntry,
  DeoptLoopEvidenceExtra,
  EventLoopReport,
  EventLoopStallEvidenceExtra,
  ExcessiveGcEvidenceExtra,
  ExtensionEntry,
  Finding,
  FindingCategory,
  FindingMeasurements,
  FindingRemediation,
  FindingSeverity,
  FrameCategory,
  GcReport,
  HotStack,
  HotStackCluster,
  Hotspot,
  JsonHotPathEvidenceExtra,
  LanternaReport,
  NodeModulesHotspotEvidenceExtra,
  ReportMeta,
  ReportSummary,
  RequireInHotPathEvidenceExtra,
  StallCorrelation,
  SyncCryptoEvidenceExtra,
} from './report/types.js';
export { defineBuiltinFinding } from './report/types.js';
export { LANTERNA_VERSION } from './report/version.generated.js';
export { DEFAULT_SAMPLE_INTERVAL_MICROS, MIN_SAMPLE_INTERVAL_MICROS } from './shared/config.js';
export { stripOptPrefix } from './shared/frame.js';
export type { LoggerLevel } from './shared/logger.js';
export { createLogger, logger, resolveLogLevel } from './shared/logger.js';
export { sleep } from './shared/sleep.js';
