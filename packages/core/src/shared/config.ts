export const HEARTBEAT_RESOLUTION_MS = 20;
export const GC_CORRELATION_LOOKAROUND_MS = 20;
export const EVENT_LOOP_STALL_INTERVAL_MS = 200;

/** Minimum % of an async op's wait time overlapping a signal window to attribute the cause to it. */
export const ASYNC_CAUSE_MIN_OVERLAP_PCT = 50;
/** runMs/durationMs at or above this classifies an async op's latency as CPU-bound (work, not waiting). */
export const ASYNC_CPU_BOUND_RATIO = 0.6;
/** An op that never ran and stayed alive past this fraction of the capture is a long-lived/idle background resource, not a latency bug. */
export const ASYNC_BACKGROUND_DURATION_RATIO = 0.9;
/** A resource that activated more than once and stayed alive past this fraction of the capture is a persistent/multiplexed handle (keep-alive socket, HTTP parser, pool, interval), not a discrete delayed callback. Lower than the idle ratio because runCount>1 is a strong persistence signal and connections start shortly after capture begins. */
export const ASYNC_LONGLIVED_DURATION_RATIO = 0.8;
/** Margin (ms) between a stall ending and a callback running that still counts as "the block delayed it" — covers heartbeat resolution and the scheduling hop, and separates a causal block from a coincidental overlap. */
export const ASYNC_STALL_READINESS_MARGIN_MS = 50;

export const INSPECTOR_STARTUP_TIMEOUT_MS = 5_000;
export const TERMINATE_GRACE_MS = 500;
export const TERMINATE_SIGTERM_WAIT_MS = 2_000;
export const TERMINATE_SIGKILL_FALLBACK_MS = 1_000;

export const DEFAULT_SAMPLE_INTERVAL_MICROS = 1000;
export const MIN_SAMPLE_INTERVAL_MICROS = 50;
