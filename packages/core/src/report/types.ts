import type { CaptureDiagnostic } from '../capture/core/types.js';
import type { ProfileSectionMap } from '../kinds/core/types.js';

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

export interface HotStackCluster {
  anchor: {
    function: string;
    file: string;
    line: number;
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

export interface CorrelatedHotspot {
  id: string;
  function: string;
  file: string;
  line: number;
  overlapPct: number;
  samplePct: number;
  rank: number;
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
  deopts: DeoptEntry[];
}

declare module '../kinds/core/types.js' {
  interface ProfileSectionMap {
    cpu: CpuProfileReport;
  }
}

export type ExtensionEntry = unknown;

/**
 * Root Lanterna report — schema v2.
 *
 * - `profiles.<kind>` holds per-kind analysis output (cpu/memory/async/...).
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
