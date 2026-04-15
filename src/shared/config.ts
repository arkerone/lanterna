export const HEARTBEAT_RESOLUTION_MS = 20;
export const GC_CORRELATION_LOOKAROUND_MS = 20;

export const INSPECTOR_STARTUP_TIMEOUT_MS = 5_000;
export const TERMINATE_GRACE_MS = 500;
export const TERMINATE_SIGTERM_WAIT_MS = 2_000;
export const TERMINATE_SIGKILL_FALLBACK_MS = 1_000;

export const DEFAULT_SAMPLE_INTERVAL_MICROS = 1000;
export const MIN_SAMPLE_INTERVAL_MICROS = 50;

export interface BlockingThresholds {
  readonly minSelfPct: number;
  readonly minTotalPct: number;
  readonly criticalPct: number;
}

export interface GcThresholds {
  readonly ratioTrigger: number;
  readonly longestPauseTrigger: number;
  readonly ratioCritical: number;
  readonly longestPauseCritical: number;
  readonly minDurationMs: number;
  readonly minSamples: number;
}

export interface EventLoopThresholds {
  readonly p99: number;
  readonly max: number;
  readonly p99LowConfidence: number;
  readonly maxLowConfidence: number;
  readonly critical: number;
  readonly strongCorrelationOverlapPct: number;
}

export interface DetectorThresholds {
  readonly blockingIo: BlockingThresholds;
  readonly syncCrypto: BlockingThresholds;
  readonly cpuBoundUserHotspot: {
    readonly minSelfPct: number;
    readonly minTotalPct: number;
    readonly warningTotalPct: number;
    readonly criticalTotalPct: number;
    readonly strongCorrelationOverlapPct: number;
  };
  readonly jsonHotPath: {
    readonly minTotalPct: number;
    readonly criticalPct: number;
  };
  readonly nodeModulesHotspot: {
    readonly minSelfPct: number;
    readonly minTotalPct: number;
    readonly criticalTotalPct: number;
  };
  readonly requireInHotPath: {
    readonly minSelfPct: number;
    readonly minTotalPct: number;
    readonly warningSelfPct: number;
  };
  readonly deoptLoop: {
    readonly minCount: number;
    readonly criticalCount: number;
  };
  readonly excessiveGc: GcThresholds;
  readonly eventLoopStall: EventLoopThresholds;
}

export const DETECTOR_THRESHOLDS: DetectorThresholds = {
  blockingIo: { minSelfPct: 0.5, minTotalPct: 1, criticalPct: 10 },
  syncCrypto: { minSelfPct: 0, minTotalPct: 1, criticalPct: 10 },
  cpuBoundUserHotspot: {
    minSelfPct: 10,
    minTotalPct: 20,
    warningTotalPct: 20,
    criticalTotalPct: 40,
    strongCorrelationOverlapPct: 50,
  },
  jsonHotPath: {
    minTotalPct: 3,
    criticalPct: 12,
  },
  nodeModulesHotspot: {
    minSelfPct: 3,
    minTotalPct: 15,
    criticalTotalPct: 35,
  },
  requireInHotPath: { minSelfPct: 0.5, minTotalPct: 1, warningSelfPct: 3 },
  deoptLoop: { minCount: 5, criticalCount: 20 },
  excessiveGc: {
    ratioTrigger: 0.1,
    longestPauseTrigger: 100,
    ratioCritical: 0.25,
    longestPauseCritical: 250,
    minDurationMs: 250,
    minSamples: 100,
  },
  eventLoopStall: {
    p99: 100,
    max: 200,
    p99LowConfidence: 200,
    maxLowConfidence: 400,
    critical: 500,
    strongCorrelationOverlapPct: 60,
  },
};
