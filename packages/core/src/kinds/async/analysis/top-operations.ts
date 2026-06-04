import type { TimeWindow } from '../../../analysis/model/correlations.js';
import { buildEventLoopStallWindows } from '../../../analysis/model/event-loop-report.js';
import type { AsyncTopOperation, UserCallerAttribution } from '../../../report/types.js';
import { HEARTBEAT_RESOLUTION_MS } from '../../../shared/config.js';
import { firstCdpAsyncContextFrame } from '../cdp-stack.js';
import {
  buildWaitWindows,
  classifyLatencyCause,
  collectDescendantRunWindows,
  deriveLatency,
  resolveAttributedFrame,
} from '../latency.js';
import type {
  AsyncCdpContext,
  AsyncChainNode,
  AsyncOperationRecord,
  AsyncStackFrame,
} from '../types.js';
import type { AsyncFrameReporter } from './frames.js';

const MAX_TOP_OPERATIONS = 50;
const MAX_INIT_STACK_FRAMES = 5;

export interface BuildTopOperationsArgs {
  sorted: AsyncOperationRecord[];
  captureDurationMs: number;
  rootByAsyncId: Map<number, number>;
  userCallerByRootId: Map<number, UserCallerAttribution>;
  recordById: Map<number, AsyncOperationRecord>;
  chainNodes: Map<number, AsyncChainNode>;
  stallWindows: TimeWindow[];
  gcWindows: TimeWindow[];
  signals: { eventLoop: boolean; gc: boolean };
  clockSyncUncertaintyMs: number;
  frameReporter: AsyncFrameReporter;
}

export function buildTopOperations(args: BuildTopOperationsArgs): AsyncTopOperation[] {
  const {
    sorted,
    captureDurationMs,
    rootByAsyncId,
    userCallerByRootId,
    recordById,
    chainNodes,
    stallWindows,
    gcWindows,
    signals,
    clockSyncUncertaintyMs,
    frameReporter,
  } = args;
  const out: AsyncTopOperation[] = [];
  for (const rec of sorted) {
    if (out.length >= MAX_TOP_OPERATIONS) break;
    const durationMs = effectiveDuration(rec, captureDurationMs);
    if (durationMs <= 0) continue;
    const initStack = rec.initStack
      .slice(0, MAX_INIT_STACK_FRAMES)
      .map(frameReporter.toReportFrame);
    const op: AsyncTopOperation = {
      asyncId: rec.asyncId,
      kind: rec.kind,
      rawType: rec.rawType,
      durationMs,
      runMs: rec.runMs,
      runCount: rec.runCount,
      initAtMs: rec.initAtMs,
      triggerAsyncId: rec.triggerAsyncId,
      orphan: rec.orphan,
      initStack,
    };
    const creationFrame = initStack[0];
    const promiseRegistrationFrame = rec.promiseRegistrationStack?.[0]
      ? frameReporter.toReportFrame(rec.promiseRegistrationStack[0])
      : undefined;
    const promiseHandlerFrame = rec.promiseHandlerStack?.[0]
      ? frameReporter.toReportFrame(rec.promiseHandlerStack[0])
      : undefined;
    const awaitFrame = rec.awaitStack?.[0]
      ? frameReporter.toReportFrame(rec.awaitStack[0])
      : undefined;
    const safeRegistrationFrame = rec.safeRegistrationStack?.[0]
      ? frameReporter.toReportFrame(rec.safeRegistrationStack[0])
      : undefined;
    const safeHandlerFrame = rec.safeHandlerStack?.[0]
      ? frameReporter.toReportFrame(rec.safeHandlerStack[0])
      : undefined;
    const executionFrame = rec.executionStack?.[0]
      ? frameReporter.toReportFrame(rec.executionStack[0])
      : undefined;
    const cdpAsyncStack = rec.cdpAsyncContext
      ? frameReporter.toReportCdpContext(rec.cdpAsyncContext)
      : undefined;
    const cdpAsyncContextFrame = cdpAsyncStack
      ? (cdpAsyncStack.frames[0] ?? cdpAsyncStack.asyncStack.find((s) => s.frames[0])?.frames[0])
      : undefined;
    const primaryFrame =
      awaitFrame ??
      executionFrame ??
      promiseHandlerFrame ??
      creationFrame ??
      safeHandlerFrame ??
      safeRegistrationFrame ??
      promiseRegistrationFrame ??
      cdpAsyncContextFrame;
    if (creationFrame) {
      op.initFrame = creationFrame;
      op.creationFrame = creationFrame;
      op.creationConfidence = 'high';
    }
    if (promiseRegistrationFrame) op.promiseRegistrationFrame = promiseRegistrationFrame;
    if (promiseHandlerFrame) op.promiseHandlerFrame = promiseHandlerFrame;
    if (awaitFrame) {
      op.awaitFrame = awaitFrame;
      op.awaitConfidence = 'high';
    }
    if (executionFrame) {
      op.executionFrame = executionFrame;
      op.executionConfidence = rec.executionConfidence ?? 'medium';
      op.cpuAttributedSamples = rec.cpuAttributedSamples ?? 0;
      op.cpuAmbiguousSamples = rec.cpuAmbiguousSamples ?? 0;
      op.clockSyncUncertaintyMs = clockSyncUncertaintyMs;
    }
    if (cdpAsyncContextFrame) {
      op.cdpAsyncContextFrame = cdpAsyncContextFrame;
      op.cdpAsyncContextConfidence = 'medium';
    }
    if (cdpAsyncStack) op.cdpAsyncStack = cdpAsyncStack;
    if (primaryFrame) {
      op.primaryFrame = primaryFrame;
      op.primaryReason = awaitFrame
        ? 'await'
        : executionFrame
          ? 'execution'
          : promiseHandlerFrame
            ? 'promise-handler'
            : creationFrame
              ? 'creation'
              : cdpAsyncContextFrame
                ? 'cdp-async-context'
                : 'creation';
      op.overallConfidence =
        op.awaitConfidence ?? op.executionConfidence ?? op.creationConfidence ?? 'medium';
    }
    const end = rec.initAtMs + durationMs;
    const latency = deriveLatency(rec, end);
    op.waitMs = latency.waitMs;
    if (latency.scheduleDelayMs !== undefined) op.scheduleDelayMs = latency.scheduleDelayMs;
    if (rec.firstRunAtMs !== undefined) op.firstRunAtMs = rec.firstRunAtMs;
    const cause = classifyLatencyCause({
      waitWindows: buildWaitWindows(rec, end),
      stallWindows,
      gcWindows,
      descendantWindows: collectDescendantRunWindows(rec.asyncId, chainNodes, recordById),
      kind: rec.kind,
      runMs: rec.runMs,
      runCount: rec.runCount,
      durationMs,
      captureDurationMs,
      signals,
      firstRunAtMs: rec.firstRunAtMs,
    });
    op.latencyCause = cause.cause;
    op.causeConfidence = cause.confidence;
    op.causeEvidence = cause.evidence;

    const attributed = resolveAttributedFrame(rec, recordById);
    if (attributed.origin) op.attributedFrameOrigin = attributed.origin;

    const rootId = rootByAsyncId.get(rec.asyncId) ?? rec.asyncId;
    const cpuCaller = userCallerByRootId.get(rootId);
    if (cpuCaller) {
      op.userCaller = cpuCaller;
    } else if (attributed.origin === 'inherited-trigger' && attributed.frame) {
      op.userCaller = frameReporter.userCallerFromAsyncFrame(
        frameReporter.toReportFrame(attributed.frame),
        {
          profilePct: 0,
          supportPct: 100,
          confidence: 'low',
          basis: 'async-stack',
        },
      );
    } else {
      op.userCaller = frameReporter.userCallerFromAsyncFrame(primaryFrame, {
        profilePct: 0,
        supportPct: 100,
        confidence: op.overallConfidence ?? 'medium',
        basis: 'async-stack',
      });
    }
    out.push(op);
  }
  return out;
}

export function effectiveDuration(record: AsyncOperationRecord, captureDurationMs: number): number {
  if (record.durationMs !== undefined) return record.durationMs;
  return Math.max(0, captureDurationMs - record.initAtMs);
}

export function correlateCdpAsyncContexts(
  records: AsyncOperationRecord[],
  contexts: readonly AsyncCdpContext[],
  frameReporter: AsyncFrameReporter,
): void {
  for (const context of contexts) {
    const frame = firstCdpAsyncContextFrame(context);
    let best: { record: AsyncOperationRecord; score: number } | undefined;
    for (const record of records) {
      const score = scoreCdpMatch(record, context, frame, frameReporter);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { record, score };
    }
    if (!best) continue;
    if (!best.record.cdpAsyncContext || best.score >= 60) {
      best.record.cdpAsyncContext = context;
    }
  }
}

export function buildAsyncSignalWindows(args: {
  eventLoopSamples: Parameters<typeof buildEventLoopStallWindows>[0];
  durationMs: number;
  eventLoopResolutionMs?: number;
}): TimeWindow[] {
  return buildEventLoopStallWindows(
    args.eventLoopSamples,
    args.durationMs,
    args.eventLoopResolutionMs ?? HEARTBEAT_RESOLUTION_MS,
  );
}

function scoreCdpMatch(
  record: AsyncOperationRecord,
  context: AsyncCdpContext,
  frame: AsyncStackFrame | undefined,
  frameReporter: AsyncFrameReporter,
): number {
  let score = 0;
  if (context.capturedAtMs !== undefined) {
    const end =
      record.destroyedAtMs ?? record.resolvedAtMs ?? record.initAtMs + (record.durationMs ?? 0);
    const inside = context.capturedAtMs >= record.initAtMs && context.capturedAtMs <= end + 25;
    if (inside) score += 40;
    const distance = Math.min(
      Math.abs(context.capturedAtMs - record.initAtMs),
      Math.abs(context.capturedAtMs - end),
    );
    if (distance <= 25) score += 20;
  }
  if (frame) {
    const stacks = [
      record.initStack,
      record.awaitStack ?? [],
      record.promiseHandlerStack ?? [],
      record.promiseRegistrationStack ?? [],
      record.safeHandlerStack ?? [],
      record.safeRegistrationStack ?? [],
    ];
    for (const stack of stacks) {
      if (stack.some((candidate) => sameFrameFile(candidate, frame, frameReporter))) {
        score += 40;
        break;
      }
    }
  }
  if (record.kind === 'promise' && context.asyncStack.length > 0) score += 10;
  return score;
}

function sameFrameFile(
  left: AsyncStackFrame,
  right: AsyncStackFrame,
  frameReporter: AsyncFrameReporter,
): boolean {
  return (
    frameReporter.normalizeFrameFile(left.file) === frameReporter.normalizeFrameFile(right.file) &&
    Math.abs(left.line - right.line) <= 2
  );
}
