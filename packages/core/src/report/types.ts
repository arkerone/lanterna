export type FrameCategory =
  | 'user'
  | 'node_modules'
  | 'node:builtin'
  | 'native'
  | 'gc'
  | 'program'
  | 'idle'
  | 'unknown';

export type OptimizationState = 'optimized' | 'interpreted' | 'unknown';

export type FindingSeverity = 'info' | 'warning' | 'critical';
export type MeasurementBasis = 'none' | 'heartbeats' | 'histogram' | 'both';
export type MeasurementConfidence = 'none' | 'low' | 'high';
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
  | 'node-modules-hotspot';

export type FindingCategory = BuiltinFindingCategory | (string & {});

export interface ReportMeta {
  schemaVersion: string;
  nodeVersion: string;
  v8Version: string;
  platform: string;
  arch: string;
  pid: number;
  startedAt: string;
  durationMs: number;
  sampleIntervalMicros: number;
  totalSamples: number;
  cwd: string;
  command: string[];
  lanternaVersion: string;
  mode: 'spawn' | 'attach' | 'in-process';
  deep: boolean;
  captureIntegrity: {
    controlChannel: boolean;
    controlChannelExpected: boolean;
    eventLoopTimed: boolean;
    gcTimed: boolean;
    cpuSamplesTimed: boolean;
    gcObserverAvailable: boolean;
    controlChannelWriteErrors: number;
    gcObserverSetupFailed: number;
    heartbeatDropped: number;
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
}

export interface ReportSummary {
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
}

export interface HotStackFrame {
  function: string;
  file: string;
  line: number;
  category: FrameCategory;
}

export interface HotStack {
  weightPct: number;
  frames: HotStackFrame[];
}

/**
 * Group of hot stacks that share the same user-code anchor (the top-most
 * user frame in the stack). Lets an agent reason about "the feature" behind
 * several superficially-different stacks instead of treating each as isolated.
 */
export interface HotStackCluster {
  anchor: {
    function: string;
    file: string;
    line: number;
  };
  /** Sum of `weightPct` across all stacks in this cluster. */
  weightPct: number;
  /** Number of hot stacks grouped under this anchor. */
  stackCount: number;
  /** Indices into `hotStacks[]` of the member stacks. */
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

export interface CorrelatedHotspot {
  id: string;
  function: string;
  file: string;
  line: number;
  overlapPct: number;
  samplePct: number;
  /** 1-indexed rank within the correlation array (1 = strongest candidate). */
  rank: number;
  /**
   * Qualitative confidence that this frame is the cause, derived from
   * absolute overlap and the gap to the next-ranked candidate:
   * - `high`: dominant alone (≥60%) or clearly ahead (≥30% with ≥15pp gap).
   * - `medium`: meaningful share (≥25%) but not dominant.
   * - `low`: weak signal — treat as hint only.
   */
  confidence: 'low' | 'medium' | 'high';
}

export interface DeoptEntry {
  function: string;
  file: string;
  line: number;
  reason: string;
  bailoutType: string;
  count: number;
  explanation: string;
}

export interface HotspotAttributionEvidence {
  hotspotId: string;
  function: string;
  file: string;
  line: number;
  samplePct: number;
  supportPct: number;
  confidence: 'low' | 'high';
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
}

export interface AttributionEvidence {
  proofLevel: Extract<FindingProofLevel, 'direct-builtin' | 'attributed-caller'>;
  attributionBasis: 'sample-path' | 'builtin-only';
  attributionConfidence: HotspotAttributionEvidence['confidence'] | 'low';
  userAttribution?: HotspotAttributionEvidence;
}

export interface BlockingIoEvidenceExtra extends AttributionEvidence {
  api: string;
  callee: string;
  eventLoopCorrelation?: StallCorrelation;
  /**
   * Sum of `totalPct` across every blocking-I/O frame in the capture.
   * Populated so an agent can see the family-wide cost even when a single
   * API crossed the per-API threshold (or when the finding was emitted only
   * because the family aggregate crossed `categoryTotalPct`).
   */
  categoryTotalPct?: number;
}

export interface SyncCryptoEvidenceExtra extends AttributionEvidence {
  callee: string;
  calleeTotalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  /** Sum of `totalPct` across every sync-crypto frame in the capture. */
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
}

export interface EventLoopStallEvidenceExtra {
  proofLevel: 'aggregate-correlation';
  p99LagMs: number;
  maxLagMs: number;
  measurementBasis: MeasurementBasis;
  confidence: MeasurementConfidence;
  histogram?: EventLoopReport['histogram'];
  stallIntervals: EventLoopReport['stallIntervals'];
  candidateHotspots: CorrelatedHotspot[];
}

export interface JsonHotPathEvidenceExtra extends AttributionEvidence {
  callee: string;
  calleeTotalPct: number;
  eventLoopCorrelation?: StallCorrelation;
  /** Sum of `totalPct` across every JSON.parse/stringify frame in the capture. */
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

export interface BuiltinFindingEvidenceExtraMap {
  'blocking-io': BlockingIoEvidenceExtra;
  'sync-crypto': SyncCryptoEvidenceExtra;
  'deopt-loop': DeoptLoopEvidenceExtra;
  'require-in-hot-path': RequireInHotPathEvidenceExtra;
  'excessive-gc': ExcessiveGcEvidenceExtra;
  'event-loop-stall': EventLoopStallEvidenceExtra;
  'json-on-hot-path': JsonHotPathEvidenceExtra;
  'node-modules-hotspot': NodeModulesHotspotEvidenceExtra;
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
  extra?: TExtra;
}

export interface FindingRemediation {
  /** Category of fix. Agents can branch on this to pick a transform. */
  kind:
    | 'async-variant'
    | 'lazy-import-hoist'
    | 'offload-worker'
    | 'replace-library'
    | 'cache'
    | 'other';
  /** Symbol or call signature to look for in user code. */
  replace?: string;
  /** Recommended replacement symbol or call signature. */
  with?: string;
  /** Source module of the replacement (e.g. `node:fs/promises`). */
  module?: string;
  /** Canonical reference URL. */
  docs?: string;
  /** Short, non-machine-actionable hint (e.g. edge-case notes). */
  notes?: string;
}

export interface FindingMeasurements {
  /**
   * Raw observed values that caused the finding to fire (e.g.
   * `{ totalPct: 12.4, categoryTotalPct: 18 }` for a blocking-io finding).
   */
  observed: Record<string, number>;
  /**
   * Threshold values the detector compared against (e.g.
   * `{ minTotalPct: 1, criticalPct: 10 }`). Lets an agent re-reason about
   * severity without parsing the `why` string.
   */
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
  severity: FindingSeverity;
  category: TCategory;
  title: string;
  evidence: FindingEvidence<TExtra>;
  measurements?: FindingMeasurements;
  priority?: FindingPriority;
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

export type ExtensionEntry = unknown;

export interface LanternaReport {
  meta: ReportMeta;
  summary: ReportSummary;
  hotspots: Hotspot[];
  hotStacks: HotStack[];
  hotStackClusters?: HotStackCluster[];
  gc: GcReport;
  eventLoop: EventLoopReport;
  deopts: DeoptEntry[];
  findings: Finding[];
  extensions?: Record<string, ExtensionEntry>;
}
