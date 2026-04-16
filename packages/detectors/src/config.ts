// ---------------------------------------------------------------------------
// Shared pattern constants
// Each detector defines its own match set below so that related detectors
// (e.g. cpu-bound-user-hotspot) can reuse these to stay in sync.
// ---------------------------------------------------------------------------

/** Regex patterns matching blocking I/O Node.js APIs, paired with their canonical API name. */
export const BLOCKING_IO_PATTERNS: ReadonlyArray<{ re: RegExp; api: string }> = [
  { re: /(^|\.)readFileSync$/, api: 'fs.readFileSync' },
  { re: /(^|\.)writeFileSync$/, api: 'fs.writeFileSync' },
  { re: /(^|\.)statSync$/, api: 'fs.statSync' },
  { re: /(^|\.)existsSync$/, api: 'fs.existsSync' },
  { re: /(^|\.)readdirSync$/, api: 'fs.readdirSync' },
  { re: /(^|\.)execSync$/, api: 'child_process.execSync' },
  { re: /(^|\.)execFileSync$/, api: 'child_process.execFileSync' },
  { re: /(^|\.)spawnSync$/, api: 'child_process.spawnSync' },
  { re: /(^|\.)gzipSync$/, api: 'zlib.gzipSync' },
  { re: /(^|\.)gunzipSync$/, api: 'zlib.gunzipSync' },
  { re: /(^|\.)deflateSync$/, api: 'zlib.deflateSync' },
  { re: /(^|\.)inflateSync$/, api: 'zlib.inflateSync' },
];

/** Synchronous crypto primitive function names (without module prefix). */
export const SYNC_CRYPTO_FNS: ReadonlyArray<string> = [
  'pbkdf2Sync',
  'scryptSync',
  'randomBytesSync',
];

/** Regex patterns matching module-loading functions (require / ESM). */
export const REQUIRE_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\.)_load$/, // Module._load (CJS require)
  /(^|\.)require$/,
  /(^|\.)loadESM$/,
];

/** Regex patterns matching JSON serialization APIs, paired with their canonical API name. */
export const JSON_FUNCTION_PATTERNS: ReadonlyArray<{ re: RegExp; api: string }> = [
  { re: /(^|\.)JSON\.parse$/, api: 'JSON.parse' },
  { re: /(^|\.)JSON\.stringify$/, api: 'JSON.stringify' },
];

// ---------------------------------------------------------------------------
// Threshold interfaces & values
// ---------------------------------------------------------------------------

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
