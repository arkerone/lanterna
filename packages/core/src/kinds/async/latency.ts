import type { TimeWindow } from '../../analysis/model/correlations.js';
import { scoreConfidence } from '../../analysis/model/correlations.js';
import type { ProfileConfidence } from '../../report/types.js';
import {
  ASYNC_BACKGROUND_DURATION_RATIO,
  ASYNC_CAUSE_MIN_OVERLAP_PCT,
  ASYNC_CPU_BOUND_RATIO,
  ASYNC_LONGLIVED_DURATION_RATIO,
  ASYNC_STALL_READINESS_MARGIN_MS,
} from '../../shared/config.js';
import { percentile } from '../../shared/percentile.js';
import {
  ASYNC_IO_KINDS,
  type AsyncAttributedFrameOrigin,
  type AsyncChainNode,
  type AsyncLatencyCause,
  type AsyncOperationKind,
  type AsyncOperationRecord,
  type AsyncStackFrame,
} from './types.js';

/**
 * Pure latency analysis for the async kind: decomposes an operation's
 * wall-clock latency, classifies its root cause by overlapping the time the
 * resource spent *waiting* with event-loop / GC / downstream-async signals,
 * and attributes a user-code frame by walking the trigger ancestry. No source
 * maps, no global state — callers (analysis.ts) handle frame normalization.
 */

export interface DerivedLatency {
  /** Wall-clock time the resource was alive but NOT executing on CPU. */
  waitMs: number;
  /** init → first `before`: queue/scheduling delay before the resource first ran. */
  scheduleDelayMs?: number;
}

export interface LatencyCauseInput {
  waitWindows: TimeWindow[];
  stallWindows: TimeWindow[];
  gcWindows: TimeWindow[];
  descendantWindows: TimeWindow[];
  kind: AsyncOperationKind;
  runMs: number;
  durationMs: number;
  /** Total capture window, to detect long-lived background resources. */
  captureDurationMs: number;
  /** Which runtime signals were actually observed — lets `unknown` say *why* it could not classify. */
  signals: { eventLoop: boolean; gc: boolean };
  /** When the resource first ran (capture-relative ms), if it ran — used to require a stall to be active when the callback became runnable, not merely overlapping the wait. */
  firstRunAtMs?: number;
  /** Number of times the resource ran (before/after pairs). >1 over ~the whole capture marks a persistent/multiplexed handle, not a single delayed callback. */
  runCount?: number;
}

export interface LatencyCauseResult {
  cause: AsyncLatencyCause;
  confidence: ProfileConfidence;
  evidence: { overlapPct: number; basis: string; windowMs: number };
}

export interface ByKindLatencyEntry {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanWaitMs: number;
}

export interface AttributedFrame {
  frame?: AsyncStackFrame;
  origin?: AsyncAttributedFrameOrigin;
}

/** End timestamp (capture-relative ms) of a resource's lifetime. */
export function effectiveEndMs(rec: AsyncOperationRecord, captureDurationMs: number): number {
  if (rec.durationMs !== undefined) return rec.initAtMs + rec.durationMs;
  return Math.max(rec.initAtMs, captureDurationMs);
}

export function deriveLatency(rec: AsyncOperationRecord, endMs: number): DerivedLatency {
  const durationMs = Math.max(0, endMs - rec.initAtMs);
  const result: DerivedLatency = { waitMs: Math.max(0, durationMs - rec.runMs) };
  if (rec.firstRunAtMs !== undefined) {
    result.scheduleDelayMs = Math.max(0, rec.firstRunAtMs - rec.initAtMs);
  }
  return result;
}

/** The complement of a resource's run windows within `[initAtMs, endMs]` — the time it was waiting. */
export function buildWaitWindows(rec: AsyncOperationRecord, endMs: number): TimeWindow[] {
  const start = rec.initAtMs;
  const end = Math.max(start, endMs);
  if (rec.runWindows.length === 0) {
    return end > start ? [{ startMs: start, endMs: end }] : [];
  }
  const runs = mergeWindows(
    rec.runWindows
      .map((w) => ({
        startMs: clamp(w.startMs, start, end),
        endMs: clamp(w.endMs, start, end),
      }))
      .filter((w) => w.endMs > w.startMs),
  );
  const gaps: TimeWindow[] = [];
  let cursor = start;
  for (const run of runs) {
    if (run.startMs > cursor) gaps.push({ startMs: cursor, endMs: run.startMs });
    cursor = Math.max(cursor, run.endMs);
  }
  if (cursor < end) gaps.push({ startMs: cursor, endMs: end });
  return gaps;
}

/** Run windows of every descendant in the trigger subtree (cycle-guarded, size-capped). */
export function collectDescendantRunWindows(
  asyncId: number,
  chainNodes: Map<number, AsyncChainNode>,
  recordById: Map<number, AsyncOperationRecord>,
  capNodes = 5000,
): TimeWindow[] {
  const windows: TimeWindow[] = [];
  const visited = new Set<number>([asyncId]);
  const stack = [...(chainNodes.get(asyncId)?.childIds ?? [])];
  let count = 0;
  while (stack.length > 0 && count < capNodes) {
    const id = stack.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    count += 1;
    const rec = recordById.get(id);
    if (rec) {
      for (const w of rec.runWindows) windows.push({ startMs: w.startMs, endMs: w.endMs });
    }
    const node = chainNodes.get(id);
    if (node) {
      for (const child of node.childIds) if (!visited.has(child)) stack.push(child);
    }
  }
  return windows;
}

export function classifyLatencyCause(input: LatencyCauseInput): LatencyCauseResult {
  const { waitWindows, kind, runMs, durationMs, captureDurationMs, signals } = input;
  const cpuRatio = durationMs > 0 ? runMs / durationMs : 0;

  // Long-lived resource that never ran and stayed alive for ~the whole capture:
  // a keep-alive / idle handle, not a latency bug. Classify it as such so its
  // incidental overlap with stalls is not mis-read as event-loop-blocked.
  if (runMs === 0 && durationMs >= captureDurationMs * ASYNC_BACKGROUND_DURATION_RATIO) {
    return {
      cause: 'background',
      confidence: 'high',
      evidence: { overlapPct: 0, basis: 'long-lived', windowMs: round(durationMs) },
    };
  }

  // Persistent/multiplexed handle (keep-alive socket, HTTP parser, pool, interval):
  // it activated more than once and stayed alive for ~the whole capture. A single
  // delayed callback runs at most once, so runCount>1 + capture-spanning marks
  // infrastructure whose aggregate waitMs is the idle gap between many activations,
  // not one blocked callback. CPU-dominated handles fall through to the CPU rule.
  if (
    (input.runCount ?? 0) > 1 &&
    durationMs >= captureDurationMs * ASYNC_LONGLIVED_DURATION_RATIO &&
    cpuRatio < ASYNC_CPU_BOUND_RATIO
  ) {
    return {
      cause: 'background',
      confidence: 'high',
      evidence: { overlapPct: 0, basis: 'long-lived-multiplexed', windowMs: round(durationMs) },
    };
  }

  // Dominated by its own execution → it is computing, not waiting.
  if (cpuRatio >= ASYNC_CPU_BOUND_RATIO) {
    return {
      cause: 'cpu-bound',
      confidence: cpuRatio >= 0.8 ? 'high' : 'medium',
      evidence: { overlapPct: round(cpuRatio * 100), basis: 'cpu-ratio', windowMs: round(runMs) },
    };
  }

  const waitTotalMs = totalMs(waitWindows);
  if (waitTotalMs <= 0) {
    return {
      cause: 'unknown',
      confidence: 'low',
      evidence: { overlapPct: 0, basis: 'none', windowMs: 0 },
    };
  }

  const mergedStalls = mergeWindows(input.stallWindows);
  const stallMs = overlapMs(waitWindows, mergedStalls);
  const gcMs = overlapMs(waitWindows, mergeWindows(input.gcWindows));
  const descMs = overlapMs(waitWindows, mergeWindows(input.descendantWindows));
  const stallPct = (stallMs / waitTotalMs) * 100;
  const gcPct = (gcMs / waitTotalMs) * 100;
  const descPct = (descMs / waitTotalMs) * 100;

  // Priority: a blocked loop explains a late callback even for an I/O resource,
  // so it wins whenever the wait overlaps a stall past the threshold — a
  // coincidental GC or downstream overlap must not outrank it on raw percentage.
  // But require the loop to have still been blocked when the callback became
  // runnable: a stall that ended long before the resource ran merely overlapped
  // a genuine I/O wait, it did not cause it.
  if (stallPct >= ASYNC_CAUSE_MIN_OVERLAP_PCT && stallActiveAtReadiness(mergedStalls, input)) {
    return {
      cause: 'event-loop-blocked',
      confidence: scoreConfidence(Math.min(100, stallPct), Math.max(gcPct, descPct)),
      evidence: {
        overlapPct: round(Math.min(100, stallPct)),
        basis: 'event-loop-stall',
        windowMs: round(stallMs),
      },
    };
  }
  // Otherwise GC pauses and downstream async work compete on overlap share.
  const ranked = [
    { cause: 'gc-pause' as const, pct: gcPct, basis: 'gc', windowMs: gcMs },
    {
      cause: 'downstream-async' as const,
      pct: descPct,
      basis: 'downstream-async',
      windowMs: descMs,
    },
  ];
  ranked.sort((a, b) => b.pct - a.pct);
  const top = ranked[0];
  if (top && top.pct >= ASYNC_CAUSE_MIN_OVERLAP_PCT) {
    const second = ranked[1]?.pct ?? 0;
    return {
      cause: top.cause,
      confidence: scoreConfidence(Math.min(100, top.pct), second),
      evidence: {
        overlapPct: round(Math.min(100, top.pct)),
        basis: top.basis,
        windowMs: round(top.windowMs),
      },
    };
  }

  if (ASYNC_IO_KINDS.has(kind)) {
    return {
      cause: 'io-wait',
      confidence: 'medium',
      evidence: { overlapPct: 0, basis: 'io-kind', windowMs: round(waitTotalMs) },
    };
  }

  // It waited, but nothing we observed explains it. Be honest about *why* we
  // could not classify: if the event-loop heartbeat was unavailable we could
  // not even check for loop blocking, so this is not the same as "no overlap".
  return {
    cause: 'unknown',
    confidence: 'low',
    evidence: {
      overlapPct: 0,
      basis: signals.eventLoop ? 'none' : 'no-eventloop-signal',
      windowMs: round(waitTotalMs),
    },
  };
}

export function buildByKindLatency(
  records: readonly AsyncOperationRecord[],
  captureDurationMs: number,
): Partial<Record<AsyncOperationKind, ByKindLatencyEntry>> {
  const buckets = new Map<AsyncOperationKind, { durations: number[]; waits: number[] }>();
  for (const rec of records) {
    const end = effectiveEndMs(rec, captureDurationMs);
    const durationMs = Math.max(0, end - rec.initAtMs);
    const { waitMs } = deriveLatency(rec, end);
    const bucket = buckets.get(rec.kind) ?? { durations: [], waits: [] };
    bucket.durations.push(durationMs);
    bucket.waits.push(waitMs);
    buckets.set(rec.kind, bucket);
  }
  const out: Partial<Record<AsyncOperationKind, ByKindLatencyEntry>> = {};
  for (const [kind, bucket] of buckets) {
    const sorted = [...bucket.durations].sort((a, b) => a - b);
    out[kind] = {
      count: sorted.length,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      p99Ms: round(percentile(sorted, 0.99)),
      maxMs: round(sorted[sorted.length - 1] ?? 0),
      meanWaitMs: round(mean(bucket.waits)),
    };
  }
  return out;
}

/**
 * Best user-code frame for an operation: its own init stack if it has a
 * user-editable frame, else the nearest such frame walking the trigger
 * ancestry, else the CPU-attributed execution frame, else a CDP async frame.
 */
export function resolveAttributedFrame(
  rec: AsyncOperationRecord,
  recordById: Map<number, AsyncOperationRecord>,
  maxHops = 64,
): AttributedFrame {
  const selfFrame = rec.initStack.find((f) => isUserEditableFile(f.file));
  if (selfFrame) return { frame: selfFrame, origin: 'self' };

  const visited = new Set<number>([rec.asyncId]);
  let current = recordById.get(rec.triggerAsyncId);
  let hops = 0;
  while (current && !visited.has(current.asyncId) && hops < maxHops) {
    visited.add(current.asyncId);
    const frame = current.initStack.find((f) => isUserEditableFile(f.file));
    if (frame) return { frame, origin: 'inherited-trigger' };
    current = recordById.get(current.triggerAsyncId);
    hops += 1;
  }

  const executionFrame = rec.executionStack?.[0];
  if (executionFrame) return { frame: executionFrame, origin: 'cpu-window' };

  const cdpFrame =
    rec.cdpAsyncContext?.frames[0] ??
    rec.cdpAsyncContext?.asyncStack.find((segment) => segment.frames[0])?.frames[0];
  if (cdpFrame) return { frame: cdpFrame, origin: 'cdp' };

  return {};
}

export function isUserEditableFile(file: string): boolean {
  if (file === '') return false;
  return !(
    file.startsWith('node:') ||
    file.includes('/node_modules/') ||
    file.includes('/pnpm-store/') ||
    file.includes('/.pnpm/') ||
    file.includes('/caches/pnpm-store/')
  );
}

// --- internal helpers ---

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function totalMs(windows: readonly TimeWindow[]): number {
  let total = 0;
  for (const w of windows) total += Math.max(0, w.endMs - w.startMs);
  return total;
}

function overlapMs(windows: readonly TimeWindow[], against: readonly TimeWindow[]): number {
  let total = 0;
  for (const w of windows) {
    for (const a of against) {
      total += Math.max(0, Math.min(w.endMs, a.endMs) - Math.max(w.startMs, a.startMs));
    }
  }
  return total;
}

/**
 * True when a stall was still active at the moment the resource became runnable
 * (its first run, else the end of its wait). A stall that ended well before the
 * resource ran did not cause its latency — it only coincided with the wait.
 */
function stallActiveAtReadiness(
  stalls: readonly TimeWindow[],
  input: Pick<LatencyCauseInput, 'waitWindows' | 'firstRunAtMs'>,
): boolean {
  let readiness = input.firstRunAtMs;
  if (readiness === undefined) {
    readiness = 0;
    for (const w of input.waitWindows) readiness = Math.max(readiness, w.endMs);
  }
  const point = readiness;
  return stalls.some(
    (s) => s.startMs <= point && point <= s.endMs + ASYNC_STALL_READINESS_MARGIN_MS,
  );
}

function mergeWindows(windows: readonly TimeWindow[]): TimeWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0];
  if (!first) return [];
  const out: TimeWindow[] = [{ startMs: first.startMs, endMs: first.endMs }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i];
    const prev = out[out.length - 1];
    if (!cur || !prev) continue;
    if (cur.startMs <= prev.endMs) prev.endMs = Math.max(prev.endMs, cur.endMs);
    else out.push({ startMs: cur.startMs, endMs: cur.endMs });
  }
  return out;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
