import type {
  AsyncStackFrameReport,
  AsyncTopOperation,
  BaseFinding,
  CorrelatedHotspot,
  Finding,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import {
  anchorForFrame,
  asyncConfidence,
  asyncEvidenceExtra,
  minConfidence,
  resolveAsyncUserCaller,
} from './async-evidence.js';

/**
 * Cross-kind detector: surfaces async operations whose latency the analysis
 * classified as `event-loop-blocked`, and points at the synchronous CPU frame
 * that blocked the loop — not the (innocent) async call site. This is the
 * answer to "the await was slow but the I/O wasn't": the callback was ready,
 * the loop was busy. Auto-skips when CPU isn't captured.
 */
export const eventLoopBlockedAsyncDetector: KindScopedDetector<'cpu' | 'async'> = {
  id: 'event-loop-blocked-async',
  kindIds: ['cpu', 'async'],
  detect({ async, cpu }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.eventLoopBlockedAsync;
    const eventLoop = cpu.report.eventLoop;
    if (!eventLoop.available || eventLoop.stallIntervals.length === 0) return [];

    const globalBlocking = [...(eventLoop.correlatedHotspots ?? [])].sort(
      (a, b) => b.overlapPct - a.overlapPct,
    )[0];
    // This detector's whole value is naming the synchronous frame that blocked
    // the loop. With no correlated CPU hotspot we have no culprit to point at,
    // and the generic event-loop-stall finding already reports "the loop was
    // blocked" — emitting a critical finding anchored at a placeholder
    // `(event-loop)` frame would be noise, so stand down.
    if (!globalBlocking) return [];
    const maxStallLagMs = eventLoop.stallIntervals.reduce((m, s) => Math.max(m, s.maxLagMs), 0);
    if (maxStallLagMs < thresholds.minStallLagMs) return [];

    const dropped = async.report.summary.recordsDropped > 0;
    const findings: Finding[] = [];
    for (const op of async.report.topOperations) {
      if (findings.length >= thresholds.maxFindings) break;
      if (op.latencyCause !== 'event-loop-blocked') continue;
      const waitMs = op.waitMs ?? 0;
      if (waitMs < thresholds.minWaitMs) continue;

      // Attribute to the *specific* stall that blocked this op (the one active
      // when it became runnable), so several distinct blockers each point at
      // their own frame instead of the globally-dominant one. Fall back to the
      // global hotspot when the op's run time matches no stall.
      const opStall = blockingStallForOp(op, eventLoop.stallIntervals);
      const blocking = opStall?.topFrame ?? globalBlocking;
      const stallMaxLagMs = opStall?.maxLagMs ?? maxStallLagMs;

      const severity: BaseFinding['severity'] =
        waitMs >= thresholds.criticalWaitMs ? 'critical' : 'warning';
      const asyncFrame = op.primaryFrame ?? op.initFrame ?? op.creationFrame;
      // `blocking` is always a real user frame (the per-stall culprit or the
      // global fallback), so the finding anchors on an actionable location.
      const blockingFrame = toFrame(blocking);
      const anchor = anchorForFrame(async.report, blockingFrame);
      const userCaller = resolveAsyncUserCaller(undefined, blockingFrame, {
        profilePct: blocking.overlapPct,
        supportPct: 100,
        confidence: blocking.confidence,
        basis: 'async-cpu-window',
      });
      const confidence: BaseFinding['confidence'] = dropped
        ? 'low'
        : minConfidence(
            minConfidence(asyncConfidence(async.report, 'high'), op.causeConfidence),
            blocking.confidence,
          );

      findings.push({
        id: `event-loop-blocked-async:${op.asyncId}`,
        profileKind: 'async',
        severity,
        category: 'event-loop-blocked-async',
        title: `Async ${op.kind} stalled ${waitMs.toFixed(0)}ms by a blocked event loop in \`${blockingFrame.function}\``,
        confidence,
        proofLevel: 'correlated-window',
        evidence: {
          file: blockingFrame.file,
          line: blockingFrame.line,
          function: blockingFrame.function,
          selfPct: blocking.samplePct,
          ...(blockingFrame.source ? { source: blockingFrame.source } : {}),
          extra: {
            asyncId: op.asyncId,
            kind: op.kind,
            rawType: op.rawType,
            waitMs,
            scheduleDelayMs: op.scheduleDelayMs ?? null,
            durationMs: op.durationMs,
            runMs: op.runMs,
            asyncCallSite: asyncFrame ?? null,
            blockingFrame,
            stallMaxLagMs,
            causeEvidence: op.causeEvidence ?? null,
            attributedFrameOrigin: op.attributedFrameOrigin ?? null,
            ...(userCaller ? { userCaller } : {}),
            ...asyncEvidenceExtra(async.report, anchor),
          },
        },
        measurements: {
          observed: { waitMs, durationMs: op.durationMs, stallMaxLagMs },
          thresholds: {
            minWaitMs: thresholds.minWaitMs,
            criticalWaitMs: thresholds.criticalWaitMs,
            minStallLagMs: thresholds.minStallLagMs,
          },
        },
        why: buildWhy(op, waitMs, blockingFrame, stallMaxLagMs, dropped),
        suggestion: `The async ${op.kind} was ready but the event loop was blocked. Open \`${blockingFrame.file}:${blockingFrame.line}\` (\`${blockingFrame.function}\`) — the synchronous work there is the real cause. Offload it to a worker thread, make it async, or chunk it. Patching the await site will not help.`,
        references: ['https://nodejs.org/en/docs/guides/dont-block-the-event-loop'],
      });
    }
    return findings;
  },
};

/** Margin (ms) between a stall ending and the callback running that still counts as "this stall blocked it" — mirrors the latency classifier's readiness margin. */
const STALL_MATCH_MARGIN_MS = 50;

type StallInterval = {
  startMs: number;
  endMs: number;
  maxLagMs: number;
  topFrame?: CorrelatedHotspot;
};

/** The stall that delayed this op: the one still active when it became runnable. */
function blockingStallForOp(
  op: AsyncTopOperation,
  stallIntervals: readonly StallInterval[],
): StallInterval | undefined {
  const ranAtMs = op.firstRunAtMs;
  if (ranAtMs === undefined) return undefined;
  return stallIntervals.find(
    (s) => s.startMs <= ranAtMs && ranAtMs <= s.endMs + STALL_MATCH_MARGIN_MS,
  );
}

function toFrame(hotspot: CorrelatedHotspot): AsyncStackFrameReport {
  return {
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    column: 0,
    ...(hotspot.source ? { source: hotspot.source } : {}),
  };
}

function buildWhy(
  op: AsyncTopOperation,
  waitMs: number,
  blockingFrame: AsyncStackFrameReport,
  stallMaxLagMs: number,
  dropped: boolean,
): string {
  const culprit = `synchronous work in \`${blockingFrame.function}\` at \`${blockingFrame.file}:${blockingFrame.line}\``;
  const drop = dropped ? ' (recordsDropped > 0; lower bound.)' : '';
  return `Async ${op.kind} #${op.asyncId} spent ~${waitMs.toFixed(0)}ms waiting, and its wait overlaps an event-loop stall (lag up to ${stallMaxLagMs.toFixed(0)}ms). The callback was ready but could not run because the loop was blocked by ${culprit}. The latency is a blocked event loop, not slow I/O.${drop}`;
}
