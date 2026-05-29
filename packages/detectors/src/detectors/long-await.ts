import type {
  AsyncTopOperation,
  BaseFinding,
  Finding,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import {
  anchorForFrame,
  asyncConfidence,
  asyncEvidenceExtra,
  resolveAsyncUserCaller,
} from './async-evidence.js';

/**
 * Surfaces the longest-running async operations. Each finding is anchored on
 * the user-code frame captured at `init` (when available) so the agent can
 * jump straight to the call site that started the slow await.
 */
export const longAwaitDetector: KindScopedDetector<'async'> = {
  id: 'long-await',
  kindIds: ['async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.longAwait;
    const report = async.report;
    const captureDurationMs = async.view.bundle.durationMs;
    if (!report.summary.available) return [];
    if (report.summary.totalOperations < thresholds.minOperations) return [];

    const dropped = report.summary.recordsDropped > 0;
    const findings: Finding[] = [];
    for (const op of rankLongAwaitOperations(report.topOperations)) {
      if (findings.length >= thresholds.maxFindings) break;
      // Persistent/multiplexed handles (keep-alive sockets, parsers, intervals)
      // carry a capture-length aggregate waitMs that is not a single long await.
      if (op.latencyCause === 'background') continue;
      if (isBackgroundWindowOperation(op, captureDurationMs)) continue;
      if (isShadowedByResumedOperation(op, report.topOperations)) continue;
      if (op.durationMs < thresholds.minDurationMs) break; // sorted desc
      const severity: BaseFinding['severity'] =
        op.durationMs >= thresholds.criticalDurationMs ? 'critical' : 'warning';
      const category = op.kind === 'promise' ? 'long-promise-await' : 'long-io-await';
      const anchorFrame = preferredLongAwaitFrame(op);
      const anchor = anchorForFrame(report, anchorFrame);
      const frame = anchor.frame;
      const userCaller = resolveAsyncUserCaller(undefined, frame, {
        confidence: op.overallConfidence ?? 'high',
        basis: 'async-stack',
      });
      // Finding confidence reflects how sure we are this is a real long await
      // (a direct duration measurement + capture quality). The latency *cause*
      // is a separate axis surfaced in evidence.extra.causeConfidence — an
      // `unknown` cause must not drag down a confidently-measured duration.
      const baseConfidence: BaseFinding['confidence'] = op.orphan ? 'medium' : 'high';
      const confidence: BaseFinding['confidence'] = dropped
        ? 'low'
        : asyncConfidence(report, baseConfidence);
      findings.push({
        id: `long-await:${op.asyncId}`,
        profileKind: 'async',
        severity,
        category,
        title: frame
          ? `${frame.function} kept an async ${op.kind} alive ${op.durationMs.toFixed(0)}ms`
          : `Async ${op.kind} (${op.rawType}) lived ${op.durationMs.toFixed(0)}ms`,
        confidence,
        proofLevel: 'direct-sample',
        evidence: {
          file: frame?.file ?? '(async)',
          line: frame?.line ?? 0,
          function: frame?.function ?? `${op.kind}#${op.asyncId}`,
          selfPct: 0,
          ...(frame?.source ? { source: frame.source } : {}),
          extra: {
            asyncId: op.asyncId,
            triggerAsyncId: op.triggerAsyncId,
            kind: op.kind,
            rawType: op.rawType,
            durationMs: op.durationMs,
            runMs: op.runMs,
            runCount: op.runCount,
            initAtMs: op.initAtMs,
            orphan: op.orphan,
            initStack: op.initStack,
            creationFrame: op.creationFrame ?? null,
            executionFrame: op.executionFrame ?? null,
            awaitFrame: op.awaitFrame ?? null,
            promiseRegistrationFrame: op.promiseRegistrationFrame ?? null,
            promiseHandlerFrame: op.promiseHandlerFrame ?? null,
            cdpAsyncContextFrame: op.cdpAsyncContextFrame ?? null,
            cdpAsyncStack: op.cdpAsyncStack ?? null,
            creationConfidence: op.creationConfidence ?? null,
            executionConfidence: op.executionConfidence ?? null,
            awaitConfidence: op.awaitConfidence ?? null,
            cdpAsyncContextConfidence: op.cdpAsyncContextConfidence ?? null,
            cpuAttributedSamples: op.cpuAttributedSamples ?? null,
            cpuAmbiguousSamples: op.cpuAmbiguousSamples ?? null,
            waitMs: op.waitMs ?? null,
            scheduleDelayMs: op.scheduleDelayMs ?? null,
            firstRunAtMs: op.firstRunAtMs ?? null,
            latencyCause: op.latencyCause ?? null,
            causeConfidence: op.causeConfidence ?? null,
            causeEvidence: op.causeEvidence ?? null,
            attributedFrameOrigin: op.attributedFrameOrigin ?? null,
            ...(userCaller ? { userCaller } : {}),
            ...asyncEvidenceExtra(report, anchor),
          },
        },
        measurements: {
          observed: {
            durationMs: op.durationMs,
            runMs: op.runMs,
            runCount: op.runCount,
          },
          thresholds: {
            minDurationMs: thresholds.minDurationMs,
            criticalDurationMs: thresholds.criticalDurationMs,
          },
        },
        why: buildWhy(op, frame, dropped),
        suggestion: buildSuggestion(op, frame),
        references: [
          'https://nodejs.org/api/async_hooks.html',
          'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
        ],
      });
    }
    return findings;
  },
};

function isBackgroundWindowOperation(op: AsyncTopOperation, captureDurationMs: number): boolean {
  return op.runMs === 0 && op.durationMs > captureDurationMs * 0.9;
}

function rankLongAwaitOperations(operations: readonly AsyncTopOperation[]): AsyncTopOperation[] {
  return [...operations].sort((a, b) => {
    const durationDelta = b.durationMs - a.durationMs;
    if (Math.abs(durationDelta) <= 50) {
      const aRan = a.runMs > 0 || a.runCount > 0;
      const bRan = b.runMs > 0 || b.runCount > 0;
      if (aRan !== bRan) return aRan ? -1 : 1;
    }
    return durationDelta;
  });
}

function isShadowedByResumedOperation(
  op: AsyncTopOperation,
  operations: readonly AsyncTopOperation[],
): boolean {
  if (op.runMs > 0 || op.runCount > 0) return false;
  const opFrameKeys = new Set(op.initStack.map(asyncFrameKey));
  if (opFrameKeys.size === 0) return false;
  return operations.some((other) => {
    if (other.asyncId === op.asyncId) return false;
    if (other.runMs <= 0 && other.runCount <= 0) return false;
    if (Math.abs(other.durationMs - op.durationMs) > 50) return false;
    return other.initStack.some((frame) => opFrameKeys.has(asyncFrameKey(frame)));
  });
}

function asyncFrameKey(frame: NonNullable<AsyncTopOperation['initFrame']>): string {
  return `${frame.file}:${frame.line}:${frame.function}`;
}

function preferredLongAwaitFrame(
  op: AsyncTopOperation,
): AsyncTopOperation['initFrame'] | undefined {
  if (
    op.latencyCause === 'cpu-bound' &&
    op.executionFrame &&
    isUserEditableFrame(op.executionFrame)
  ) {
    return op.executionFrame;
  }
  return (
    firstEditableFrame(op.initStack) ??
    (op.kind === 'promise'
      ? (op.awaitFrame ?? op.promiseHandlerFrame ?? op.initFrame)
      : (op.creationFrame ?? op.initFrame))
  );
}

function firstEditableFrame(
  frames: readonly NonNullable<AsyncTopOperation['initFrame']>[],
): AsyncTopOperation['initFrame'] | undefined {
  return frames.find(isUserEditableFrame);
}

function buildSuggestion(op: AsyncTopOperation, frame: AsyncTopOperation['initFrame']): string {
  const timeoutGuidance =
    'Network and database calls should always carry a deadline (`AbortController`, axios `timeout`, `pg` statement_timeout, etc.).';
  if (op.latencyCause === 'event-loop-blocked') {
    return 'The callback was ready but the event loop was blocked. Find and offload the synchronous work (CPU-heavy loops, sync I/O, large JSON.parse/stringify) — see the `event-loop-blocked-async` finding for the blocking frame. Fixing this call site will not help.';
  }
  if (op.latencyCause === 'cpu-bound') {
    return frame
      ? `\`${frame.file}:${frame.line}\` (\`${frame.function}\`) spends its time running, not waiting (~${(op.runMs ?? 0).toFixed(0)}ms on CPU). Move the heavy computation to a worker thread or chunk it so the event loop can breathe.`
      : 'This operation spends its time running on CPU, not waiting. Move the heavy computation to a worker thread or chunk it.';
  }
  if (op.latencyCause === 'downstream-async') {
    return `This operation was waiting on its own descendant async work (triggerAsyncId=${op.triggerAsyncId}). Trace the inner operations it awaits and optimize those, not this call site.`;
  }
  if (!frame) {
    return `Trace the trigger chain (triggerAsyncId=${op.triggerAsyncId}) to find the call site. Add explicit timeouts on network/database calls and verify every promise has a path to resolve or reject.`;
  }
  if (!isUserEditableFrame(frame)) {
    return `Do not patch the dependency file directly. Find the user-code caller that starts \`${frame.function}\` at \`${frame.file}:${frame.line}\`, then configure the timeout, abort signal, pool option, or query deadline at that call site. ${timeoutGuidance}`;
  }
  return `Open \`${frame.file}:${frame.line}\` (\`${frame.function}\`) and add a timeout/abort path to this operation. ${timeoutGuidance}`;
}

function buildWhy(
  op: AsyncTopOperation,
  frame: AsyncTopOperation['initFrame'],
  dropped: boolean,
): string {
  const head = frame
    ? `\`${frame.function}\` at \`${frame.file}:${frame.line}\` started an async ${op.kind} resource that lived ${op.durationMs.toFixed(0)}ms`
    : `An async ${op.kind} resource (${op.rawType}) was alive for ${op.durationMs.toFixed(0)}ms`;
  const split =
    op.waitMs !== undefined
      ? ` (~${op.waitMs.toFixed(0)}ms waiting, ${(op.runMs ?? 0).toFixed(0)}ms on CPU)`
      : '';
  const tail = op.orphan ? ' and never resolved before the capture ended' : '';
  const drop = dropped
    ? ' Records were dropped during capture (`recordsDropped > 0`), so this is a lower bound.'
    : '';
  return `${head}${split}${tail}.${drop} ${causeNarrative(op)}`;
}

function causeNarrative(op: AsyncTopOperation): string {
  switch (op.latencyCause) {
    case 'event-loop-blocked':
      return 'Its wait overlaps an event-loop stall — the latency is a blocked loop, not slow I/O. Find the synchronous work hogging the loop.';
    case 'gc-pause':
      return 'Its wait overlaps garbage-collection pauses — reduce allocation pressure on the hot path.';
    case 'downstream-async':
      return 'It was waiting on its own descendant async work — optimize the inner operation it awaits.';
    case 'cpu-bound':
      return 'Most of its lifetime was spent running on CPU, not waiting — move the heavy work off the async path.';
    case 'io-wait':
      return 'It was genuinely waiting on external I/O — add a deadline/timeout and verify the remote side.';
    default:
      return 'Long-lived async operations are usually slow I/O, network calls without a timeout, or promises waiting on something that already finished.';
  }
}

function isUserEditableFrame(frame: AsyncTopOperation['initFrame']): boolean {
  if (!frame) return false;
  return !isDependencyOrRuntimePath(frame.source?.file ?? frame.file);
}

function isDependencyOrRuntimePath(file: string): boolean {
  return (
    file.startsWith('node:') ||
    file.includes('/node_modules/') ||
    file.includes('/pnpm-store/') ||
    file.includes('/.pnpm/') ||
    file.includes('/caches/pnpm-store/')
  );
}
