import type { CaptureDiagnostic } from '../capture/core/types.js';
import type { ProfileSectionMap } from '../kinds/core/types.js';
import type {
  CONFIDENCE_LEVELS,
  FINDING_REPORT_PROOF_LEVELS,
  FINDING_SEVERITIES,
  FRAME_CATEGORIES,
  MEASUREMENT_BASES,
  MEASUREMENT_CONFIDENCES,
  OPTIMIZATION_STATES,
} from './schema/primitives.js';

export type FrameCategory = (typeof FRAME_CATEGORIES)[number];
export type OptimizationState = (typeof OPTIMIZATION_STATES)[number];

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type MeasurementBasis = (typeof MEASUREMENT_BASES)[number];
export type MeasurementConfidence = (typeof MEASUREMENT_CONFIDENCES)[number];
export type ProfileConfidence = (typeof CONFIDENCE_LEVELS)[number];
export type FindingConfidence = (typeof CONFIDENCE_LEVELS)[number];
export type FindingReportProofLevel = (typeof FINDING_REPORT_PROOF_LEVELS)[number];
export type FindingProofLevel =
  | 'direct-builtin'
  | 'attributed-caller'
  | 'aggregate-correlation'
  | 'deopt-trace-only';

export type BuiltinFindingCategory =
  | 'blocking-io'
  | 'sync-crypto'
  | 'deopt-loop'
  | 'require-in-hot-path'
  | 'excessive-gc'
  | 'event-loop-stall'
  | 'json-on-hot-path'
  | 'node-modules-hotspot'
  | 'cpu-hotspot';

export type FindingCategory = BuiltinFindingCategory | (string & {});

/**
 * Original (pre-compilation) source position resolved from a source map.
 * Joined onto frames whose generated `file`/`line` could be remapped.
 */
export interface SourceLocation {
  /** Source path: relative to cwd when filesystem-resolvable, otherwise the raw map source URL. */
  file: string;
  line: number;
  column?: number;
  /** Symbol name from the map's `names` field, when available. */
  name?: string;
}

export interface SourceMapsIntegrity {
  enabled: boolean;
  applicable?: boolean;
  status?: 'not-applicable' | 'ok' | 'partial' | 'failed';
  framesResolved: number;
  framesUnresolved: number;
  /**
   * `framesResolved / (framesResolved + framesUnresolved)`, or 1 when source
   * maps are not applicable to the observed JS. Only frames whose generated
   * URL had a loaded or expected source map contribute to the denominator.
   */
  coverage: number;
  mapsLoaded: number;
  failures: Array<{ url: string; reason: string }>;
}

export interface ReportMeta {
  schemaVersion: string;
  nodeVersion: string;
  v8Version: string;
  platform: string;
  arch: string;
  pid: number;
  startedAt: string;
  durationMs: number;
  cwd: string;
  command: string[];
  lanternaVersion: string;
  mode: 'spawn' | 'attach' | 'in-process';
  /** Ordered list of profile kind ids that contributed to this report. */
  profileKinds: string[];
  /** Per-kind meta contributions. Each kind writes under `kinds[kind.id]`. */
  kinds: Record<string, unknown>;
  captureIntegrity: {
    controlChannel: boolean;
    controlChannelExpected: boolean;
    eventLoopTimed: boolean;
    gcTimed: boolean;
    gcObserverAvailable: boolean;
    controlChannelWriteErrors: number;
    gcObserverSetupFailed: number;
    heartbeatDropped: number;
    diagnostics?: CaptureDiagnostic[];
    /** Per-kind integrity contributions. */
    kinds: Record<string, unknown>;
    sourceMaps?: SourceMapsIntegrity;
  };
}

export interface SummaryUserHotspot {
  function: string;
  file: string;
  line: number;
  selfPct: number;
  totalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  alternativeHotspots?: AlternativeHotspotEvidence[];
  source?: SourceLocation;
}

/**
 * CPU-specific summary — used to live at the root under `report.summary`;
 * now under `report.profiles.cpu.summary` in schema v2.
 */
export interface CpuSummary {
  totalCpuMs: number;
  onCpuRatio: number;
  userCodeRatio: number;
  nodeModulesRatio: number;
  builtinRatio: number;
  nativeRatio: number;
  gcRatio: number;
  idleRatio: number;
  topCategory: FrameCategory;
  dominantBlockingKind: 'sync-crypto' | 'blocking-io' | null;
  topCpuCulprit?: SummaryUserHotspot;
  topRequestEntry?: SummaryUserHotspot;
  topUserHotspot?: SummaryUserHotspot;
}

export interface HotspotRef {
  id: string;
  pct: number;
}

export interface Hotspot {
  id: string;
  function: string;
  file: string;
  line: number;
  column: number;
  category: FrameCategory;
  package?: string;
  selfMs: number;
  selfPct: number;
  totalMs: number;
  totalPct: number;
  callers: HotspotRef[];
  callees: HotspotRef[];
  optimizationState: OptimizationState;
  source?: SourceLocation;
  userCaller?: UserCallerAttribution;
}

export interface HotStackFrame {
  function: string;
  file: string;
  line: number;
  category: FrameCategory;
  source?: SourceLocation;
}

export interface HotStack {
  weightPct: number;
  frames: HotStackFrame[];
}

export interface HotStackCluster {
  anchor: {
    function: string;
    file: string;
    line: number;
    source?: SourceLocation;
  };
  weightPct: number;
  stackCount: number;
  memberIndices: number[];
}

export interface CorrelationCoverage {
  samplesInWindows: number;
  samplesAttributed: number;
  windowCount: number;
  attributionRate: number;
}

export interface GcReport {
  totalPauseMs: number;
  count: {
    scavenge: number;
    markSweep: number;
    incremental: number;
    other: number;
  };
  longestPauseMs: number;
  pausesOver10ms: Array<{ atMs: number; kind: string; durationMs: number }>;
  correlatedHotspots?: CorrelatedHotspot[];
  correlationCoverage?: CorrelationCoverage;
}

export interface EventLoopReport {
  maxLagMs: number;
  p99LagMs: number;
  p50LagMs: number;
  meanLagMs: number;
  sampleCount: number;
  stallIntervals: Array<{ startMs: number; endMs: number; maxLagMs: number }>;
  available: boolean;
  measurementBasis: MeasurementBasis;
  confidence: MeasurementConfidence;
  histogram?: {
    maxLagMs: number;
    p99LagMs: number;
    p50LagMs: number;
    meanLagMs: number;
  };
  correlatedHotspots?: CorrelatedHotspot[];
  correlationCoverage?: CorrelationCoverage;
}

export interface ProfileQuality {
  confidence: ProfileConfidence;
  sampleCount: number;
  durationMs: number;
  idleRatio: number;
  samplesTimed: boolean;
  durationBasis: 'timeDeltas' | 'sampleInterval';
  reasons: string[];
  recommendations: string[];
}

export interface CorrelatedHotspot {
  id: string;
  function: string;
  file: string;
  line: number;
  overlapPct: number;
  samplePct: number;
  rank: number;
  confidence: 'low' | 'medium' | 'high';
  source?: SourceLocation;
}

export interface DeoptEntry {
  function: string;
  file: string;
  line: number;
  reason: string;
  bailoutType: string;
  count: number;
  explanation: string;
  source?: SourceLocation;
}

export interface UserCallerAttribution {
  function: string;
  file: string;
  line: number;
  column?: number;
  source?: SourceLocation;
  /** 0 means the sampled user frame itself; 1 means the closest user frame to an external callee. */
  stackDistance?: number;
  /** Percent of the whole profile attributed to this user caller. */
  profilePct: number;
  /** Percent of the external frame's cost explained by this caller. */
  supportPct: number;
  confidence: 'low' | 'medium' | 'high';
  basis: 'cpu-sample-path' | 'heap-sample-path' | 'async-stack' | 'async-cpu-window';
}

export interface StallCorrelation {
  overlapPct: number;
  samplePct: number;
}

export interface AlternativeHotspotEvidence {
  id: string;
  function: string;
  file: string;
  line: number;
  selfPct: number;
  totalPct: number;
  source?: SourceLocation;
}

export interface AttributionEvidence {
  proofLevel: Extract<FindingProofLevel, 'direct-builtin' | 'attributed-caller'>;
  attributionBasis: 'sample-path' | 'builtin-only';
  attributionConfidence: 'low' | 'medium' | 'high';
  userCaller?: UserCallerAttribution;
  candidateCallers?: UserCallerAttribution[];
}

export interface BlockingIoEvidenceExtra extends AttributionEvidence {
  api: string;
  callee: string;
  eventLoopCorrelation?: StallCorrelation;
  categoryTotalPct?: number;
}

export interface SyncCryptoEvidenceExtra extends AttributionEvidence {
  callee: string;
  calleeTotalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  categoryTotalPct?: number;
}

export interface DeoptLoopEvidenceExtra {
  proofLevel: 'deopt-trace-only';
  reason: string;
  bailoutType: string;
  count: number;
  hotspotTotalPct?: number;
}

export interface RequireInHotPathEvidenceExtra extends AttributionEvidence {
  callee: string;
}

export interface ExcessiveGcEvidenceExtra {
  proofLevel: 'aggregate-correlation';
  gcRatio: number;
  longestPauseMs: number;
  timedGcEventCount: number;
  ratioConfidence: 'high' | 'medium';
  counts: GcReport['count'];
  candidateHotspots: CorrelatedHotspot[];
  userCaller?: UserCallerAttribution;
}

export interface EventLoopStallEvidenceExtra {
  proofLevel: 'aggregate-correlation' | 'hotspot-fallback';
  p99LagMs: number;
  maxLagMs: number;
  sampleCount: number;
  measurementBasis: MeasurementBasis;
  confidence: MeasurementConfidence;
  histogram?: EventLoopReport['histogram'];
  stallIntervals: EventLoopReport['stallIntervals'];
  candidateHotspots: CorrelatedHotspot[];
  fallbackHotspots?: AlternativeHotspotEvidence[];
  correlationCoverage?: CorrelationCoverage;
}

export interface JsonHotPathEvidenceExtra extends AttributionEvidence {
  callee: string;
  calleeTotalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  categoryTotalPct?: number;
}

export interface NodeModulesHotspotEvidenceExtra extends AttributionEvidence {
  package?: string;
  callee: string;
  calleeFile?: string;
  calleeLine?: number;
  calleeTotalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  alternativeHotspots?: AlternativeHotspotEvidence[];
}

export interface CpuHotspotEvidenceExtra {
  proofLevel: 'direct-user-hotspot' | 'inclusive-user-entry';
  mode: 'self' | 'inclusive-entry';
  category: FrameCategory;
  selfPct: number;
  totalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  alternativeHotspots: AlternativeHotspotEvidence[];
}

export interface BuiltinFindingEvidenceExtraMap {
  'blocking-io': BlockingIoEvidenceExtra;
  'sync-crypto': SyncCryptoEvidenceExtra;
  'deopt-loop': DeoptLoopEvidenceExtra;
  'require-in-hot-path': RequireInHotPathEvidenceExtra;
  'excessive-gc': ExcessiveGcEvidenceExtra;
  'event-loop-stall': EventLoopStallEvidenceExtra;
  'json-on-hot-path': JsonHotPathEvidenceExtra;
  'node-modules-hotspot': NodeModulesHotspotEvidenceExtra;
  'cpu-hotspot': CpuHotspotEvidenceExtra;
}

export type BuiltinFindingEvidenceExtra = Exclude<
  BuiltinFindingEvidenceExtraMap[BuiltinFindingCategory],
  undefined
>;

export type FindingEvidenceExtra = BuiltinFindingEvidenceExtra | Record<string, unknown>;

export interface FindingEvidence<TExtra = FindingEvidenceExtra> {
  file: string;
  line: number;
  function: string;
  selfPct: number;
  source?: SourceLocation;
  extra?: TExtra;
}

export interface FindingRemediation {
  kind:
    | 'async-variant'
    | 'lazy-import-hoist'
    | 'offload-worker'
    | 'replace-library'
    | 'cache'
    | 'other';
  replace?: string;
  with?: string;
  module?: string;
  docs?: string;
  notes?: string;
}

export interface FindingMeasurements {
  observed: Record<string, number>;
  thresholds: Record<string, number>;
}

export interface FindingPriority {
  score: number;
  impactEstimateMs?: number;
  actionConfidence: 'low' | 'medium' | 'high';
}

export interface BaseFinding<
  TCategory extends FindingCategory = FindingCategory,
  TExtra = FindingEvidenceExtra,
> {
  id: string;
  /** Profile kind that produced this finding (e.g. 'cpu', 'memory', 'async'). */
  profileKind: string;
  severity: FindingSeverity;
  category: TCategory;
  title: string;
  evidence: FindingEvidence<TExtra>;
  measurements?: FindingMeasurements;
  priority?: FindingPriority;
  confidence?: FindingConfidence;
  proofLevel?: FindingReportProofLevel;
  remediation?: FindingRemediation;
  why: string;
  suggestion: string;
  references: string[];
}

export type BuiltinFinding<C extends BuiltinFindingCategory = BuiltinFindingCategory> = BaseFinding<
  C,
  BuiltinFindingEvidenceExtraMap[C]
>;

export type ExtensionFinding = BaseFinding<string, Record<string, unknown> | undefined>;

export type Finding = BuiltinFinding | ExtensionFinding;

export function defineBuiltinFinding<C extends BuiltinFindingCategory>(
  finding: BuiltinFinding<C>,
): BuiltinFinding<C> {
  return finding;
}

/**
 * CPU profile report section — what lives under `report.profiles.cpu` in
 * schema v2. Was top-level in schema v1.
 */
export interface CpuProfileReport {
  summary: CpuSummary;
  hotspots: Hotspot[];
  hotStacks: HotStack[];
  hotStackClusters?: HotStackCluster[];
  gc: GcReport;
  eventLoop: EventLoopReport;
  quality: ProfileQuality;
  deopts: DeoptEntry[];
}

export interface MemorySeriesStats {
  startBytes: number;
  endBytes: number;
  minBytes: number;
  maxBytes: number;
  meanBytes: number;
  p95Bytes: number;
  slopeBytesPerSec: number;
}

export interface MemoryUsageSample {
  atMs: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface MemoryHotAllocator {
  id: string;
  function: string;
  file: string;
  line: number;
  column: number;
  category: FrameCategory;
  package?: string;
  selfBytes: number;
  selfPct: number;
  totalBytes: number;
  totalPct: number;
  source?: SourceLocation;
  userCaller?: UserCallerAttribution;
}

export type HeapSnapshotSuspectedPattern =
  | 'closure'
  | 'event-listener'
  | 'timer'
  | 'cache'
  | 'unknown';

export interface HeapSnapshotGrowthEntry {
  name: string;
  countDelta: number;
  selfSizeDeltaBytes: number;
  retainedSizeDeltaBytes: number;
}

export interface HeapSnapshotRetainerPath {
  constructorName: string;
  retainedBytes: number;
  path: string[];
  suspectedPattern: HeapSnapshotSuspectedPattern;
  confidence: 'low' | 'medium' | 'high';
}

export interface HeapSnapshotAnalysisReport {
  available: boolean;
  mode: 'start-end';
  start: { path: string };
  end: { path: string };
  summary: {
    totalRetainedGrowthBytes: number;
    topGrowingConstructor?: string;
  };
  growthByConstructor: HeapSnapshotGrowthEntry[];
  retainerPaths: HeapSnapshotRetainerPath[];
  warnings: string[];
}

export interface MemorySummary {
  totalSampledBytes: number;
  samplingIntervalBytes: number;
  rss?: MemorySeriesStats;
  heapUsed?: MemorySeriesStats;
  external?: MemorySeriesStats;
  arrayBuffers?: MemorySeriesStats;
  topAllocator?: {
    function: string;
    file: string;
    line: number;
    selfPct: number;
    totalPct: number;
    source?: SourceLocation;
    userCaller?: UserCallerAttribution;
  };
  /** `external` over `heapUsed`, averaged across the series. */
  externalRatio?: number;
}

export interface MemoryProfileQuality {
  confidence: ProfileConfidence;
  reasons: string[];
  recommendations: string[];
}

/**
 * Memory profile report section — lives under `report.profiles.memory`. Built
 * from V8 sampling heap profiler output plus a `process.memoryUsage()` time
 * series collected by the preload hook.
 */
export interface MemoryProfileReport {
  summary: MemorySummary;
  hotAllocators: MemoryHotAllocator[];
  quality: MemoryProfileQuality;
  memoryUsage: {
    available: boolean;
    sampleIntervalMs: number;
    sampleCount: number;
    firstSample?: MemoryUsageSample;
    lastSample?: MemoryUsageSample;
    samples?: MemoryUsageSample[];
  };
  heapSnapshotAnalysis?: HeapSnapshotAnalysisReport;
}

export type AsyncOperationKindReport =
  | 'promise'
  | 'timer'
  | 'immediate'
  | 'tcp'
  | 'udp'
  | 'fs'
  | 'http'
  | 'http2'
  | 'tls'
  | 'dns'
  | 'pipe'
  | 'process'
  | 'tickobject'
  | 'microtask'
  | 'other';

export interface AsyncSummary {
  available: boolean;
  collectedVia: 'async-hooks' | 'cdp-only' | 'unavailable';
  totalOperations: number;
  byKind: Partial<Record<AsyncOperationKindReport, number>>;
  durationStats?: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    meanMs: number;
  };
  concurrency?: {
    meanInflight: number;
    maxInflight: number;
    meanActive: number;
    maxActive: number;
  };
  orphanCount: number;
  recordsDropped: number;
  topAsyncHotFile?: {
    function: string;
    file: string;
    line: number;
    score: number;
    confidence: ProfileConfidence;
    source?: SourceLocation;
    userCaller?: UserCallerAttribution;
  };
}

export interface AsyncStackFrameReport {
  function: string;
  file: string;
  line: number;
  column: number;
  source?: SourceLocation;
}

export interface AsyncCdpContextReport {
  source:
    | 'Runtime.exceptionThrown'
    | 'Runtime.consoleAPICalled'
    | 'Debugger.paused'
    | 'Runtime.evaluate';
  proofLevel: 'cdp-debugger-async-stack';
  capturedAtMs?: number;
  frames: AsyncStackFrameReport[];
  asyncStack: Array<{ description?: string; frames: AsyncStackFrameReport[] }>;
}

export interface AsyncTopOperation {
  asyncId: number;
  kind: AsyncOperationKindReport;
  rawType: string;
  durationMs: number;
  runMs: number;
  runCount: number;
  initAtMs: number;
  triggerAsyncId: number;
  orphan: boolean;
  /** First user-code frame at init, when available. */
  initFrame?: AsyncStackFrameReport;
  primaryFrame?: AsyncStackFrameReport;
  primaryReason?: 'creation' | 'execution' | 'await' | 'promise-handler' | 'cdp-async-context';
  creationFrame?: AsyncStackFrameReport;
  executionFrame?: AsyncStackFrameReport;
  awaitFrame?: AsyncStackFrameReport;
  promiseRegistrationFrame?: AsyncStackFrameReport;
  promiseHandlerFrame?: AsyncStackFrameReport;
  cdpAsyncContextFrame?: AsyncStackFrameReport;
  cdpAsyncStack?: AsyncCdpContextReport;
  creationConfidence?: ProfileConfidence;
  executionConfidence?: ProfileConfidence;
  awaitConfidence?: ProfileConfidence;
  cdpAsyncContextConfidence?: ProfileConfidence;
  cpuAttributedSamples?: number;
  cpuAmbiguousSamples?: number;
  clockSyncUncertaintyMs?: number;
  overallConfidence?: ProfileConfidence;
  userCaller?: UserCallerAttribution;
  /** Top frames at init, filtered to user code (capped). */
  initStack: AsyncStackFrameReport[];
}

export interface AsyncChainSummary {
  rootAsyncId: number;
  rootKind: AsyncOperationKindReport;
  depth: number;
  totalOperations: number;
  totalDurationMs: number;
  deepestPath: AsyncOperationKindReport[];
  rootFrame?: AsyncStackFrameReport;
  deepestFrame?: AsyncStackFrameReport;
  dominantFile?: string;
}

export interface AsyncOrphan {
  asyncId: number;
  kind: AsyncOperationKindReport;
  rawType: string;
  initAtMs: number;
  ageMs: number;
  triggerAsyncId: number;
  initFrame?: AsyncStackFrameReport;
  initStack: AsyncStackFrameReport[];
}

export interface AsyncCpuAttributionEntry {
  rootAsyncId: number;
  rootKind: AsyncOperationKindReport;
  /** Frame anchored on the root resource (init site of the chain top). */
  rootFrame?: AsyncStackFrameReport;
  /** Best user-code CPU frame observed while this async chain was executing. */
  executionFrame?: AsyncStackFrameReport;
  executionConfidence?: ProfileConfidence;
  /** Estimated % of capture-window CPU spent in this chain's `before/after` runs. */
  cpuPct: number;
  /** Estimated CPU time (ms) attributed to this chain. */
  cpuMs: number;
  /** Number of resources in the chain that contributed. */
  contributingOperations: number;
  userCaller?: UserCallerAttribution;
}

export interface AsyncCpuAttribution {
  available: boolean;
  /** Why attribution was unavailable (cpu kind absent, no run windows, ...). */
  reason?: string;
  /** Total CPU% covered by attributed run windows. */
  attributedCpuPct: number;
  totalCpuMs: number;
  cpuAttributedSamples: number;
  cpuAmbiguousSamples: number;
  clockSyncUncertaintyMs: number;
  topChains: AsyncCpuAttributionEntry[];
}

export interface AsyncProfileQuality {
  confidence: ProfileConfidence;
  instrumentationMode: 'off' | 'safe' | 'full';
  attachPartialCapture: boolean;
  operationCount: number;
  sampledStackRatio: number;
  initStackCoverageRatio: number;
  cdpAsyncStackCoverageRatio: number;
  recordsDropped: number;
  maxRecords: number;
  runWindowCount: number;
  cpuAttributionCoveragePct: number;
  cpuAmbiguousSamples: number;
  clockSyncUncertaintyMs: number;
  reasons: string[];
  recommendations: string[];
}

export interface AsyncHotFile {
  file: string;
  score: number;
  confidence: ProfileConfidence;
  primaryFrame: AsyncStackFrameReport;
  operationCount: number;
  totalDurationMs: number;
  orphanCount: number;
  maxOrphanAgeMs: number;
  maxChainDepth: number;
  cpuPct: number;
  runMs: number;
  kindBreakdown: Partial<Record<AsyncOperationKindReport, number>>;
  sampleAsyncIds: number[];
  userCaller?: UserCallerAttribution;
}

export interface AsyncConcurrencyTimelineSample {
  atMs: number;
  active: number;
  inflight: number;
}

export interface AsyncProfileReport {
  summary: AsyncSummary;
  quality: AsyncProfileQuality;
  hotFiles: AsyncHotFile[];
  topOperations: AsyncTopOperation[];
  chains: AsyncChainSummary[];
  orphans: AsyncOrphan[];
  concurrencyTimeline: AsyncConcurrencyTimelineSample[];
  filteredCounts: Record<string, number>;
  cdpAsyncContexts: AsyncCdpContextReport[];
  cpuAttribution: AsyncCpuAttribution;
}

declare module '../kinds/core/types.js' {
  interface ProfileSectionMap {
    cpu: CpuProfileReport;
    memory: MemoryProfileReport;
    async: AsyncProfileReport;
  }
}

export type ExtensionEntry = unknown;

/**
 * Root Lanterna report — schema v2.
 *
 * - `profiles.<reportSectionKey>` holds per-kind analysis output (cpu/memory/async/...).
 * - `findings` stays cross-kind; each finding is tagged `profileKind`.
 * - `extensions` is the free-form escape hatch for custom analyzer sections
 *   that aren't tied to a profile kind.
 */
export interface LanternaReport {
  meta: ReportMeta;
  profiles: Partial<ProfileSectionMap>;
  findings: Finding[];
  extensions?: Record<string, ExtensionEntry>;
}
