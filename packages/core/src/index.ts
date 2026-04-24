// Analysis pipeline
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
export { AttachSource, createAttachSource } from './capture/attach.js';
export type { RunCaptureOptions } from './capture/coordinator.js';
// Capture
export { createManualStopSignal, runCapture } from './capture/coordinator.js';
export type {
  AttachStartOptions,
  CaptureBundle,
  CaptureIntegrity,
  ConnectedSource,
  EventLoopHistogram,
  EventLoopSample,
  LiveSourceSignals,
  PreloadContribution,
  ProfileSource,
  RawCpuProfile,
  RawDeopt,
  RawGcEvent,
  RuntimeSignalsData,
  SpawnStartOptions,
  TargetInfo,
} from './capture/core/types.js';
export { createSpawnSource, SpawnSource } from './capture/spawn.js';
// Stable extension-author API surface.
export * as extensionApi from './extension-api.js';
// Inspector
export type { InspectorTargetDescriptor } from './inspector/discovery.js';
export { openInspectorForPid, readInspectableTargetsByPid } from './inspector/discovery.js';
// Kinds
export {
  createKindRegistry,
  ProfileKindRegistry,
} from './kinds/core/registry.js';
export type {
  CaptureKindDataMap,
  CaptureProbe,
  KindAnalysisContext as KindContributorContext,
  KindAnalysisContributor,
  KindFinalizeHook,
  KindProbeOptions,
  KindViews,
  ProfileKind,
  ProfileSectionMap,
} from './kinds/core/types.js';
export { defineProfileKind } from './kinds/core/types.js';
export type {
  CpuAnalysisView,
  CpuKindData,
  CpuKindOptions,
} from './kinds/cpu/index.js';
// CPU kind (built-in)
export {
  cpuFinalize,
  createCpuAnalysisContributor,
  createCpuProbe,
  createCpuProfileKind,
} from './kinds/cpu/index.js';
// Report
export { buildLanternaReport, serializeReport } from './report/index.js';
export { LANTERNA_REPORT_SCHEMA_VERSION } from './report/meta.js';
export type {
  AlternativeHotspotEvidence,
  AttributionEvidence,
  BaseFinding,
  BlockingIoEvidenceExtra,
  BuiltinFinding,
  BuiltinFindingCategory,
  CpuProfileReport,
  CpuSummary,
  DeoptEntry,
  DeoptLoopEvidenceExtra,
  EventLoopReport,
  EventLoopStallEvidenceExtra,
  ExcessiveGcEvidenceExtra,
  ExtensionEntry,
  Finding,
  FindingCategory,
  FindingMeasurements,
  FindingPriority,
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
  RequireInHotPathEvidenceExtra,
  StallCorrelation,
  SummaryUserHotspot,
  SyncCryptoEvidenceExtra,
} from './report/types.js';
export { defineBuiltinFinding } from './report/types.js';
export { LANTERNA_VERSION } from './report/version.generated.js';

// Shared
export { DEFAULT_SAMPLE_INTERVAL_MICROS, MIN_SAMPLE_INTERVAL_MICROS } from './shared/config.js';
export { stripOptPrefix } from './shared/frame.js';
export type { LoggerLevel } from './shared/logger.js';
export { createLogger, logger, resolveLogLevel } from './shared/logger.js';
export { sleep } from './shared/sleep.js';
