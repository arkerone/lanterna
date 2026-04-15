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

export type BuiltinFindingCategory =
  | 'blocking-io'
  | 'sync-crypto'
  | 'deopt-loop'
  | 'require-in-hot-path'
  | 'excessive-gc'
  | 'event-loop-stall';

export type FindingCategory = BuiltinFindingCategory | (string & {});

export interface ReportMeta {
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
    eventLoopTimed: boolean;
    gcTimed: boolean;
    cpuSamplesTimed: boolean;
  };
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
}

export interface CorrelatedHotspot {
  id: string;
  function: string;
  file: string;
  line: number;
  overlapPct: number;
  samplePct: number;
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

export interface AttributionEvidence {
  attributionBasis: 'sample-path' | 'builtin-only';
  attributionConfidence: HotspotAttributionEvidence['confidence'] | 'low';
  userAttribution?: HotspotAttributionEvidence;
}

export interface BlockingIoEvidenceExtra extends AttributionEvidence {
  api: string;
  callee: string;
  eventLoopCorrelation?: StallCorrelation;
}

export interface SyncCryptoEvidenceExtra extends AttributionEvidence {
  callee: string;
  calleeTotalPct: number;
  eventLoopCorrelation?: StallCorrelation;
}

export interface DeoptLoopEvidenceExtra {
  reason: string;
  bailoutType: string;
  count: number;
}

export interface ExcessiveGcEvidenceExtra {
  gcRatio: number;
  longestPauseMs: number;
  timedGcEventCount: number;
  ratioConfidence: 'high' | 'medium';
  counts: GcReport['count'];
  candidateHotspots: CorrelatedHotspot[];
}

export interface EventLoopStallEvidenceExtra {
  p99LagMs: number;
  maxLagMs: number;
  measurementBasis: MeasurementBasis;
  confidence: MeasurementConfidence;
  histogram?: EventLoopReport['histogram'];
  stallIntervals: EventLoopReport['stallIntervals'];
  candidateHotspots: CorrelatedHotspot[];
}

export interface BuiltinFindingEvidenceExtraMap {
  'blocking-io': BlockingIoEvidenceExtra;
  'sync-crypto': SyncCryptoEvidenceExtra;
  'deopt-loop': DeoptLoopEvidenceExtra;
  'require-in-hot-path': undefined;
  'excessive-gc': ExcessiveGcEvidenceExtra;
  'event-loop-stall': EventLoopStallEvidenceExtra;
}

export type BuiltinFindingEvidenceExtra =
  Exclude<BuiltinFindingEvidenceExtraMap[BuiltinFindingCategory], undefined>;

export type FindingEvidenceExtra =
  | BuiltinFindingEvidenceExtra
  | Record<string, unknown>;

export interface FindingEvidence<TExtra = FindingEvidenceExtra> {
  file: string;
  line: number;
  function: string;
  selfPct: number;
  extra?: TExtra;
}

export interface BaseFinding<TCategory extends FindingCategory = FindingCategory, TExtra = FindingEvidenceExtra> {
  id: string;
  severity: FindingSeverity;
  category: TCategory;
  title: string;
  evidence: FindingEvidence<TExtra>;
  why: string;
  suggestion: string;
  references: string[];
}

export type BuiltinFinding<C extends BuiltinFindingCategory = BuiltinFindingCategory> =
  BaseFinding<C, BuiltinFindingEvidenceExtraMap[C]>;

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
  gc: GcReport;
  eventLoop: EventLoopReport;
  deopts: DeoptEntry[];
  findings: Finding[];
  extensions?: Record<string, ExtensionEntry>;
}
