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

/** Regex patterns matching sync-crypto APIs, paired with their canonical API name. */
export const SYNC_CRYPTO_PATTERNS: ReadonlyArray<{ re: RegExp; api: string }> = SYNC_CRYPTO_FNS.map(
  (name) => ({ re: new RegExp(`(^|\\.)${name}$`), api: `crypto.${name}` }),
);

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
  /**
   * Emit findings for every API bucket in the family when the sum of
   * `totalPct` across the family crosses this threshold, even if no single
   * API crosses `minTotalPct`. Guards against the "death by a thousand cuts"
   * pattern where e.g. 6 × `fs.statSync` @ 0.6% each hides a 3.6% cumulative.
   */
  readonly categoryTotalPct: number;
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
    readonly categoryTotalPct: number;
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

/**
 * Detector thresholds.
 *
 * Calibration philosophy — these numbers are tuned empirically against a mix
 * of captured profiles (see `packages/detectors/test/findings.test.ts`) with
 * the explicit goal of minimising false positives at `warning`/`critical`
 * severity. Rules of thumb:
 *
 * - `minSelfPct` / `minTotalPct` are the "should I emit at all" gate.
 *   `self` = exclusive CPU in the frame itself, `total` = inclusive (frame
 *   plus its callees). A frame typically has far more total than self when
 *   it's a bridge into a hot builtin; self is small when the work happens
 *   downstream. We gate on both so a frame qualifies as evidence even when
 *   the cost lives in a direct callee (blocking I/O is self-heavy, while
 *   sync-crypto routing is total-heavy).
 *
 * - `criticalPct` / `criticalTotalPct` is set at the level where a single
 *   frame that size alone is worth paging: 10% of on-CPU for a single
 *   blocking-I/O API is massive in a request handler.
 *
 * - `categoryTotalPct` is an aggregate escape hatch — several frames in the
 *   same family, each below `minTotalPct`, can still produce a finding if
 *   their sum crosses this value (the "death by a thousand cuts" case).
 *
 * - Event-loop `p99`/`max` split by confidence: the histogram-only path
 *   (no heartbeats available) is noisier, so we require roughly 2× the lag
 *   before firing to keep false-positive rate comparable.
 *
 * Change any value here without also updating the tests at your peril — the
 * snapshot fixtures depend on specific frames crossing specific bars.
 */
export const DETECTOR_THRESHOLDS: DetectorThresholds = {
  // 1% inclusive CPU in a single blocking-I/O call is already a smoking gun
  // in a request handler; 0.5% self guards against builtins that route
  // through a trampoline with low self but high total.
  blockingIo: { minSelfPct: 0.5, minTotalPct: 1, criticalPct: 10, categoryTotalPct: 3 },
  // sync-crypto self is always near 0 (work happens in native); total-only
  // gate. Same shape as blocking-io for consistency.
  syncCrypto: { minSelfPct: 0, minTotalPct: 1, criticalPct: 10, categoryTotalPct: 3 },
  // Higher bar for user-code hotspots: we only want to surface a frame as
  // "CPU-bound" when it really dominates, since it's also the fallback
  // category when no specific detector fires.
  cpuBoundUserHotspot: {
    minSelfPct: 10,
    minTotalPct: 20,
    warningTotalPct: 20,
    criticalTotalPct: 40,
    strongCorrelationOverlapPct: 50,
  },
  // JSON is everywhere, so the per-API bar (3%) is higher than blocking-io;
  // a 12% JSON.stringify on the request path is considered critical.
  jsonHotPath: {
    minTotalPct: 3,
    criticalPct: 12,
    categoryTotalPct: 6,
  },
  // node_modules: even a hot dep frame is only worth flagging if it
  // meaningfully dominates (15% total). Below that it's usually background.
  nodeModulesHotspot: {
    minSelfPct: 3,
    minTotalPct: 15,
    criticalTotalPct: 35,
  },
  // require/import on hot path: we fire early because even 1% total means
  // module resolution is happening per request. warningSelfPct escalates
  // when the resolver itself is churning (3% self = lots of cache misses).
  requireInHotPath: { minSelfPct: 0.5, minTotalPct: 1, warningSelfPct: 3 },
  // 5 deopts for the same function is meaningful (V8 stops optimising
  // after a few tries); 20+ is pathological.
  deoptLoop: { minCount: 5, criticalCount: 20 },
  excessiveGc: {
    // 10% of on-CPU in GC is the soft trigger; 25% is critical.
    ratioTrigger: 0.1,
    longestPauseTrigger: 100,
    ratioCritical: 0.25,
    longestPauseCritical: 250,
    // Don't fire ratio-only on very short captures (not enough samples to
    // trust the ratio).
    minDurationMs: 250,
    minSamples: 100,
  },
  eventLoopStall: {
    // Heartbeat-backed thresholds.
    p99: 100,
    max: 200,
    // Histogram-only (less precise): ~2× to keep FP rate equivalent.
    p99LowConfidence: 200,
    maxLowConfidence: 400,
    critical: 500,
    // Only blame a single frame for the stall if it dominates the
    // attributed samples within stall windows.
    strongCorrelationOverlapPct: 60,
  },
};
