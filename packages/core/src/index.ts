export { startSpawnCapture, SpawnSource } from './capture/spawn.js';
export { startAttachCapture, AttachSource } from './capture/attach.js';
export type {
  RawCapture,
  CaptureHandle,
  SourceHandle,
  ProfileSource,
  SpawnStartOptions,
  AttachStartOptions,
  TargetInfo,
  RawCpuProfile,
  RawGcEvent,
  EventLoopSample,
  RawDeopt,
  EventLoopHistogram,
  CaptureIntegrity,
} from './capture/core/types.js';

export {
  buildLanternaReport,
  serializeReport,
} from './report/index.js';
export { LANTERNA_VERSION } from './report/version.generated.js';
export type {
  LanternaReport,
  Finding,
  BuiltinFinding,
  BaseFinding,
  FindingCategory,
  BuiltinFindingCategory,
  FindingSeverity,
  Hotspot,
  HotStack,
  GcReport,
  EventLoopReport,
  DeoptEntry,
  ReportSummary,
  ReportMeta,
  ExtensionEntry,
  FrameCategory,
  AttributionEvidence,
  AlternativeHotspotEvidence,
  StallCorrelation,
  BlockingIoEvidenceExtra,
  SyncCryptoEvidenceExtra,
  JsonHotPathEvidenceExtra,
  NodeModulesHotspotEvidenceExtra,
  RequireInHotPathEvidenceExtra,
  EventLoopStallEvidenceExtra,
  ExcessiveGcEvidenceExtra,
  DeoptLoopEvidenceExtra,
  CpuBoundUserHotspotEvidenceExtra,
} from './report/types.js';
export { defineBuiltinFinding } from './report/types.js';

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
  FindingAnalyzer,
  SectionAnalyzer,
  ExtensionEntry as AnalysisExtensionEntry,
  ExtensionMap,
} from './analysis/core/types.js';

export type { HotspotAttribution } from './analysis/model/hotspots.js';

export { openInspectorForPid, readInspectableTargetsByPid } from './inspector/discovery.js';
export type { InspectorTargetDescriptor } from './inspector/discovery.js';

export { logger, createLogger, resolveLogLevel } from './shared/logger.js';
export type { LoggerLevel } from './shared/logger.js';
export { sleep } from './shared/sleep.js';
export { DEFAULT_SAMPLE_INTERVAL_MICROS, MIN_SAMPLE_INTERVAL_MICROS } from './shared/config.js';
export { stripOptPrefix } from './shared/frame.js';
