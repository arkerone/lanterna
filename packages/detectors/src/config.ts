// ---------------------------------------------------------------------------
// Shared pattern constants
// Each detector defines its own match set below so that related detectors
// can reuse these to stay in sync.
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
  readonly cpuHotspot: CpuHotspotThresholds;
  readonly deoptLoop: {
    readonly minCount: number;
    readonly criticalCount: number;
  };
  readonly excessiveGc: GcThresholds;
  readonly eventLoopStall: EventLoopThresholds;
  readonly memoryGrowth: MemoryGrowthThresholds;
  readonly largeAllocator: LargeAllocatorThresholds;
  readonly externalBufferPressure: ExternalBufferPressureThresholds;
  readonly allocInHotPath: AllocInHotPathThresholds;
  readonly longAwait: LongAwaitThresholds;
  readonly orphanAsyncResource: OrphanAsyncResourceThresholds;
  readonly deepAsyncChain: DeepAsyncChainThresholds;
  readonly microtaskFlood: MicrotaskFloodThresholds;
  readonly hotAsyncContext: HotAsyncContextThresholds;
}

export interface HotAsyncContextThresholds {
  /** A chain root crossing this %CPU is reported. */
  readonly minCpuPct: number;
  /** Above this %CPU the finding is `critical`. */
  readonly criticalCpuPct: number;
  /** Don't fire unless attributed coverage is at least this %. */
  readonly minAttributedCoveragePct: number;
  /** Cap on emitted findings. */
  readonly maxFindings: number;
}

export interface CpuHotspotThresholds {
  /** User-code self CPU that is actionable without a pattern-specific detector. */
  readonly minSelfPct: number;
  /** User-code inclusive CPU that becomes a lower-confidence caller lead when no self hotspot exists. */
  readonly minTotalPct: number;
  /** Above either value the generic hotspot is `critical`. */
  readonly criticalPct: number;
  /** Emit at most this many generic hotspots. */
  readonly maxFindings: number;
}

export interface LongAwaitThresholds {
  /** An async operation lasting longer than this (ms) is reported. */
  readonly minDurationMs: number;
  /** Above this duration the finding is `critical`. */
  readonly criticalDurationMs: number;
  /** Cap on emitted findings. */
  readonly maxFindings: number;
  /** Don't fire if fewer ops were captured than this (low confidence). */
  readonly minOperations: number;
}

export interface OrphanAsyncResourceThresholds {
  /** Don't fire below this orphan count — short-lived processes have transients. */
  readonly minOrphans: number;
  /** Above this orphan count the finding is `critical`. */
  readonly criticalOrphans: number;
  /** Skip orphans younger than this many ms (likely just inflight at flush time). */
  readonly minOrphanAgeMs: number;
}

export interface DeepAsyncChainThresholds {
  /** Chain depth that triggers a finding. */
  readonly minDepth: number;
  /** Chain depth that escalates to `critical`. */
  readonly criticalDepth: number;
  /** Cap on emitted findings. */
  readonly maxFindings: number;
}

export interface MicrotaskFloodThresholds {
  /** Mean inflight async resources crossing this triggers a `warning`. */
  readonly meanInflight: number;
  /** Max inflight crossing this triggers `critical`. */
  readonly criticalMaxInflight: number;
  /** Don't fire below this number of concurrency samples. */
  readonly minSamples: number;
}

export interface MemoryGrowthThresholds {
  /** RSS growth in MB/sec that triggers a `warning`. */
  readonly rssGrowthWarnMBPerSec: number;
  /** RSS growth in MB/sec that triggers a `critical`. */
  readonly rssGrowthCriticalMBPerSec: number;
  /** heapUsed growth in MB/sec that triggers a `warning`. */
  readonly heapGrowthWarnMBPerSec: number;
  /** Don't fire on captures shorter than this duration (ms). */
  readonly minDurationMs: number;
  /** Don't fire when fewer samples are available. */
  readonly minSamples: number;
}

export interface LargeAllocatorThresholds {
  /** A frame allocating more than this fraction of total bytes triggers a finding. */
  readonly minTotalPct: number;
  /** Cap on the number of allocators reported. */
  readonly maxFindings: number;
  /** Above this fraction the finding is `critical`. */
  readonly criticalTotalPct: number;
}

export interface ExternalBufferPressureThresholds {
  /** `external / heapUsed` ratio crossing this triggers `warning`. */
  readonly warnRatio: number;
  /** Same but for `critical`. */
  readonly criticalRatio: number;
  /** Floor on absolute external bytes mean (MB) — avoids firing on tiny apps. */
  readonly minExternalMeanMB: number;
}

export interface AllocInHotPathThresholds {
  /** Hotspot must contribute more than this %CPU. */
  readonly minCpuTotalPct: number;
  /** Allocator must contribute more than this % of allocated bytes. */
  readonly minAllocTotalPct: number;
  /** Combined score over this triggers `critical`. */
  readonly criticalCombinedPct: number;
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
  // Generic user-code CPU hotspot fallback. Pattern detectors should own
  // known anti-patterns; self-heavy user frames are actionable, inclusive-only
  // user frames are emitted as lower-confidence caller/context leads.
  cpuHotspot: { minSelfPct: 10, minTotalPct: 25, criticalPct: 40, maxFindings: 3 },
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
  // Sustained RSS growth above 1 MB/sec is a strong leak signal in steady-state
  // workloads; 5 MB/sec is critical. Heap-only is noisier (GC fluctuations).
  memoryGrowth: {
    rssGrowthWarnMBPerSec: 1,
    rssGrowthCriticalMBPerSec: 5,
    heapGrowthWarnMBPerSec: 1,
    minDurationMs: 2000,
    minSamples: 8,
  },
  // 15% of total sampled bytes from a single frame is significant; 40% is critical.
  largeAllocator: {
    minTotalPct: 15,
    criticalTotalPct: 40,
    maxFindings: 5,
  },
  // Off-heap (Buffer / TypedArray) over 50% of heapUsed often means the app
  // hoards binary data outside V8's GC reach.
  externalBufferPressure: {
    warnRatio: 0.5,
    criticalRatio: 1.5,
    minExternalMeanMB: 32,
  },
  // A frame is co-hot when it crosses both bars; combined pct is the sum
  // normalized to a 0..200 scale, treated like a 0..100 rank.
  allocInHotPath: {
    minCpuTotalPct: 5,
    minAllocTotalPct: 5,
    criticalCombinedPct: 60,
  },
  // 100ms is the conventional p99 latency budget for a Node.js request. An
  // async op alive that long is worth surfacing; 1s is unambiguously bad.
  longAwait: {
    minDurationMs: 100,
    criticalDurationMs: 1000,
    maxFindings: 5,
    minOperations: 5,
  },
  // Orphans: dozens at flush is normal. A few hundred persistent async
  // resources older than 1s is a leak signature.
  orphanAsyncResource: {
    minOrphans: 50,
    criticalOrphans: 500,
    minOrphanAgeMs: 1000,
  },
  // Async chains > 30 deep usually indicate runaway recursion or callback
  // hell; > 100 is pathological.
  deepAsyncChain: {
    minDepth: 30,
    criticalDepth: 100,
    maxFindings: 3,
  },
  // Sustained backlog of pending async work — tracks closely with event-loop
  // saturation but uses async data so it surfaces even without lag samples.
  microtaskFlood: {
    meanInflight: 200,
    criticalMaxInflight: 2000,
    minSamples: 10,
  },
  // Hot-async-context: 10% CPU under one async chain is meaningful in a
  // request-handler-style app; 30% is the prime optimization target. Require
  // at least 15% of total CPU to be attributable to async chains before
  // emitting — below that the ranking is dominated by sampling noise and we
  // risk fingering a chain that just happened to overlap a hot frame.
  hotAsyncContext: {
    minCpuPct: 10,
    criticalCpuPct: 30,
    minAttributedCoveragePct: 15,
    maxFindings: 3,
  },
};
