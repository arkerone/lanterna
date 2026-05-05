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
export {
  createFindingAnalyzerFromKindScopedDetector,
  type KindScopedDetector,
  type KindScopedDetectorBundle,
  type KindScopedDetectorShared,
} from './analysis/kind-scoped-detector.js';
export type { NoiseFilter, NoiseUrlMatch } from './analysis/noise-filters.js';
export {
  classifyNoisePackage,
  classifyNoiseUrl,
  getRegisteredNoiseFilters,
  isNoiseCategory,
  isNoiseRetainerPath,
  registerNoiseFilter,
  shouldKeepNoiseFrames,
} from './analysis/noise-filters.js';
export {
  type CreateSourceMapResolverOptions,
  createNoopSourceMapResolver,
  createSourceMapResolver,
  type SourceMapResolver,
} from './analysis/sourcemap/resolver.js';
export { AttachSource, createAttachSource } from './capture/attach.js';
export type { RunCaptureOptions } from './capture/coordinator.js';
// Capture
export { createManualStopSignal, runCapture } from './capture/coordinator.js';
export type {
  RawSamplingHeapProfile,
  RawSamplingHeapProfileNode,
  RawSamplingHeapProfileSample,
} from './capture/core/heap.js';
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
// Async kind (built-in)
export type {
  AsyncAnalysisView,
  AsyncChainNode,
  AsyncConcurrencySample,
  AsyncIntegrityCounters,
  AsyncKindData,
  AsyncKindOptions,
  AsyncOperationKind,
  AsyncOperationRecord,
  AsyncProbeOptions,
  AsyncRunWindow,
  AsyncStackFrame,
} from './kinds/async/index.js';
export {
  createAsyncAnalysisContributor,
  createAsyncProbe,
  createAsyncProfileKind,
  DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  DEFAULT_ASYNC_MAX_RECORDS,
  DEFAULT_ASYNC_STACK_DEPTH,
  MAX_ASYNC_STACK_DEPTH,
} from './kinds/async/index.js';
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
export type { CpuProbeOptions } from './kinds/cpu/probe.js';
export type {
  HeapSnapshotAnalysisOptions,
  HeapSnapshotAnalysisReport,
  HeapSnapshotGrowthEntry,
  HeapSnapshotRetainerPath,
  HeapSnapshotSuspectedPattern,
  MemoryAnalysisView,
  MemoryKindData,
  MemoryKindOptions,
  MemoryProbeOptions,
} from './kinds/memory/index.js';
// Memory kind (built-in)
export {
  createMemoryAnalysisContributor,
  createMemoryProbe,
  createMemoryProfileKind,
  DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  DEFAULT_MEMORY_USAGE_INTERVAL_MS,
} from './kinds/memory/index.js';
// Profile orchestration
export {
  configureProfilePipeline,
  createDefaultAnalysisPipeline,
} from './profile/pipeline.js';
export {
  attachProfile,
  runProfile,
} from './profile/profile.js';
export type {
  AttachProfileOptions,
  AttachProgressEvent,
  ProfilePipelinePlugin,
  ProfilePluginContext,
  RunProfileOptions,
  RunProgressEvent,
} from './profile/types.js';
// Report
export { buildLanternaReport, serializeReport } from './report/index.js';
export { LANTERNA_REPORT_SCHEMA_VERSION } from './report/meta.js';
export { buildReportSchema } from './report/schema.js';
export type {
  AlternativeHotspotEvidence,
  AsyncChainSummary,
  AsyncConcurrencyTimelineSample,
  AsyncCpuAttribution,
  AsyncCpuAttributionEntry,
  AsyncHotFile,
  AsyncOperationKindReport,
  AsyncOrphan,
  AsyncProfileQuality,
  AsyncProfileReport,
  AsyncStackFrameReport,
  AsyncSummary,
  AsyncTopOperation,
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
  HeapSnapshotAnalysisReport as ReportHeapSnapshotAnalysisReport,
  HeapSnapshotGrowthEntry as ReportHeapSnapshotGrowthEntry,
  HeapSnapshotRetainerPath as ReportHeapSnapshotRetainerPath,
  HeapSnapshotSuspectedPattern as ReportHeapSnapshotSuspectedPattern,
  HotStack,
  HotStackCluster,
  Hotspot,
  JsonHotPathEvidenceExtra,
  LanternaReport,
  MemoryHotAllocator,
  MemoryProfileReport,
  MemorySeriesStats,
  MemorySummary,
  MemoryUsageSample,
  NodeModulesHotspotEvidenceExtra,
  ReportMeta,
  RequireInHotPathEvidenceExtra,
  StallCorrelation,
  SummaryUserHotspot,
  SyncCryptoEvidenceExtra,
  UserCallerAttribution,
} from './report/types.js';
export { defineBuiltinFinding } from './report/types.js';
export { LANTERNA_VERSION } from './report/version.generated.js';

// Shared
export { DEFAULT_SAMPLE_INTERVAL_MICROS, MIN_SAMPLE_INTERVAL_MICROS } from './shared/config.js';
export { stripOptPrefix } from './shared/frame.js';
export type { LoggerLevel } from './shared/logger.js';
export { createLogger, logger, resolveLogLevel } from './shared/logger.js';
export { sleep } from './shared/sleep.js';
