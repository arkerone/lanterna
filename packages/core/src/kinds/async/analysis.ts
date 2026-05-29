import { fileURLToPath } from 'node:url';
import { buildGcCorrelationWindows, type TimeWindow } from '../../analysis/model/correlations.js';
import { buildEventLoopStallWindows } from '../../analysis/model/event-loop-report.js';
import type { SourceMapResolver } from '../../analysis/sourcemap/resolver.js';
import type { CaptureBundle, RawCpuProfile } from '../../capture/core/types.js';
import type {
  AsyncChainSummary,
  AsyncCpuAttribution,
  AsyncCpuAttributionEntry,
  AsyncHotFile,
  AsyncOperationKindReport,
  AsyncOrphan,
  AsyncProfileQuality,
  AsyncProfileReport,
  AsyncStackFrameReport,
  AsyncSummary,
  AsyncTopOperation,
  ProfileConfidence,
  UserCallerAttribution,
} from '../../report/types.js';
import { HEARTBEAT_RESOLUTION_MS } from '../../shared/config.js';
import type { KindAnalysisContext, KindAnalysisContributor } from '../core/types.js';
import { firstCdpAsyncContextFrame } from './cdp-stack.js';
import {
  buildByKindLatency,
  buildWaitWindows,
  classifyLatencyCause,
  collectDescendantRunWindows,
  deriveLatency,
  resolveAttributedFrame,
} from './latency.js';
import type {
  AsyncCdpContext,
  AsyncChainNode,
  AsyncKindData,
  AsyncOperationRecord,
  AsyncStackFrame,
} from './types.js';

const MAX_TOP_OPERATIONS = 50;
const MAX_CHAINS = 25;
const MAX_ORPHANS = 50;
const MAX_CPU_ATTRIBUTION_CHAINS = 10;
const MAX_INIT_STACK_FRAMES = 5;
const MAX_HOT_FILES = 25;
const MAX_HOT_FILE_SAMPLE_IDS = 10;

export interface AsyncAnalysisView {
  data: AsyncKindData;
  bundle: CaptureBundle;
  /** Async trigger tree, keyed by asyncId. */
  chainNodes: Map<number, AsyncChainNode>;
  /** Sorted records by total duration desc. */
  sortedByDuration: AsyncOperationRecord[];
  /** Map asyncId → root asyncId in its trigger tree. */
  rootByAsyncId: Map<number, number>;
  /** CPU attribution per chain root, when CPU kind was captured. */
  cpuAttribution: AsyncCpuAttribution;
}

declare module '../core/types.js' {
  interface KindViews {
    async: AsyncAnalysisView;
  }
}

/**
 * Module-level resolver, set for the duration of a single `analyze()` call.
 * Async frames are produced from many helper functions; threading the
 * resolver through every signature would inflate the API surface for marginal
 * gain. The pipeline is single-threaded per analysis pass, so this is safe.
 */
let activeResolver: SourceMapResolver | undefined;

export function createAsyncAnalysisContributor(): KindAnalysisContributor<AsyncKindData> {
  return {
    analyze(ctx: KindAnalysisContext<AsyncKindData>) {
      const { data, bundle } = ctx;
      activeResolver = ctx.options.sourceMaps;
      try {
        if (activeResolver) {
          const urls = collectAsyncFrameUrls(data);
          activeResolver.prepare(urls);
        }
        analyzeInner(ctx, data, bundle);
      } finally {
        activeResolver = undefined;
      }
    },
  };
}

function collectAsyncFrameUrls(data: AsyncKindData): Set<string> {
  const urls = new Set<string>();
  const addStack = (stack: AsyncStackFrame[] | undefined): void => {
    if (!stack) return;
    for (const frame of stack) if (frame.file) urls.add(frame.file);
  };
  for (const rec of data.records) {
    addStack(rec.initStack);
    addStack(rec.promiseRegistrationStack);
    addStack(rec.promiseHandlerStack);
    addStack(rec.awaitStack);
    addStack(rec.safeRegistrationStack);
    addStack(rec.safeHandlerStack);
    addStack(rec.executionStack);
  }
  for (const ctx of data.cdpAsyncContexts ?? []) {
    addStack(ctx.frames);
    for (const segment of ctx.asyncStack) addStack(segment.frames);
  }
  return urls;
}

function analyzeInner(
  ctx: KindAnalysisContext<AsyncKindData>,
  data: AsyncKindData,
  bundle: CaptureBundle,
): void {
  const sortedByDuration = [...data.records].sort(
    (a, b) => effectiveDuration(b, bundle.durationMs) - effectiveDuration(a, bundle.durationMs),
  );

  const recordById = new Map<number, AsyncOperationRecord>();
  for (const rec of data.records) recordById.set(rec.asyncId, rec);
  correlateCdpAsyncContexts(data.records, data.cdpAsyncContexts ?? []);

  const chainNodes = buildChainTree(data.records, recordById);
  const rootByAsyncId = buildRootMap(data.records, recordById);

  const chains = buildChains(chainNodes, recordById);
  const orphans = buildOrphans(data.records, bundle.durationMs);

  // Signal windows used to classify why each operation spent its latency
  // (event-loop stalls, GC pauses, downstream async work). CPU sample times are
  // profile-relative (≈ capture-relative); the residual skew is the small
  // Profiler.start↔capture-start startup gap, reported via clockSyncUncertaintyMs.
  const clockSyncUncertaintyMs = Math.max(
    bundle.cdpClockJitterMs ?? 0,
    data.clockResolutionMs ?? 0,
  );
  const stallWindows: TimeWindow[] = buildEventLoopStallWindows(
    bundle.runtimeSignals.eventLoopSamples,
    bundle.durationMs,
    bundle.runtimeSignals.eventLoopResolutionMs ?? HEARTBEAT_RESOLUTION_MS,
  );
  // Exact GC pause windows (no ±lookaround padding): for latency attribution we
  // ask "did GC run *during* this wait", so each window must be the real pause,
  // not padded. Padding sub-millisecond scavenges by tens of ms makes them tile
  // the whole timeline and blanket every wait with a spurious 100% gc overlap.
  const gcWindows = buildGcCorrelationWindows(bundle.runtimeSignals.gcEvents, bundle.durationMs, 0);
  // Which runtime signals were actually observed — so cause classification can
  // say *why* it could not explain a wait rather than silently guessing.
  const signals = {
    eventLoop:
      Boolean(bundle.captureIntegrity.eventLoopTimed) &&
      bundle.runtimeSignals.eventLoopSamples.length > 0,
    gc: Boolean(bundle.captureIntegrity.gcTimed),
  };

  const cpuAttribution = buildCpuAttribution({
    records: data.records,
    recordById,
    rootByAsyncId,
    chainNodes,
    cpuKind: bundle.kinds.cpu as { cpuProfile: RawCpuProfile } | undefined,
    clockSyncUncertaintyMs,
  });
  const userCallerByRootId = new Map<number, UserCallerAttribution>();
  for (const entry of cpuAttribution.topChains) {
    if (entry.userCaller) userCallerByRootId.set(entry.rootAsyncId, entry.userCaller);
  }
  const topOperations = buildTopOperations({
    // Orphans (resources still in flight at capture end) have a fictional
    // capture-clamped duration that would otherwise dominate this ranking; they
    // are reported separately in `orphans[]`.
    sorted: sortedByDuration.filter((rec) => !rec.orphan),
    captureDurationMs: bundle.durationMs,
    rootByAsyncId,
    userCallerByRootId,
    recordById,
    chainNodes,
    stallWindows,
    gcWindows,
    signals,
    clockSyncUncertaintyMs,
  });
  const quality = buildQuality({
    data,
    cpuAttribution,
    recordById,
    clockSyncUncertaintyMs,
    eventLoopSignalAvailable: signals.eventLoop,
  });
  const hotFiles = buildHotFiles({
    records: data.records,
    captureDurationMs: bundle.durationMs,
    chainNodes,
    rootByAsyncId,
    cpuAttribution,
    quality,
  });
  const summary = buildSummary(data, bundle.durationMs, hotFiles);

  const report: AsyncProfileReport = {
    summary,
    quality,
    hotFiles,
    topOperations,
    chains,
    orphans,
    concurrencyTimeline: data.concurrency,
    filteredCounts: data.filteredCounts,
    cdpAsyncContexts: (data.cdpAsyncContexts ?? []).map(toReportCdpContext),
    cpuAttribution,
  };

  ctx.writeSection<AsyncProfileReport>(report);
  ctx.setContextView<AsyncAnalysisView>({
    data,
    bundle,
    chainNodes,
    sortedByDuration,
    rootByAsyncId,
    cpuAttribution,
  });
}

function effectiveDuration(rec: AsyncOperationRecord, captureDurationMs: number): number {
  if (rec.durationMs !== undefined) return rec.durationMs;
  return Math.max(0, captureDurationMs - rec.initAtMs);
}

function toReportFrame(frame: AsyncStackFrame): AsyncStackFrameReport {
  const source = activeResolver?.resolve(frame.file, frame.line, frame.column);
  const reportFrame: AsyncStackFrameReport = {
    function: frame.function,
    file: normalizeFrameFile(frame.file),
    line: frame.line,
    column: frame.column,
  };
  if (source) reportFrame.source = source;
  return reportFrame;
}

function normalizeFrameFile(file: string): string {
  if (!file.startsWith('file://')) return file;
  try {
    return fileURLToPath(file);
  } catch {
    return file;
  }
}

function userCallerFromAsyncFrame(
  frame: AsyncStackFrameReport | undefined,
  options: Pick<UserCallerAttribution, 'profilePct' | 'supportPct' | 'confidence' | 'basis'>,
): UserCallerAttribution | undefined {
  if (!frame) return undefined;
  const caller: UserCallerAttribution = {
    function: frame.function,
    file: frame.file,
    line: frame.line,
    column: frame.column,
    profilePct: options.profilePct,
    supportPct: options.supportPct,
    confidence: options.confidence,
    basis: options.basis,
  };
  if (frame.source) caller.source = frame.source;
  return caller;
}

function toReportCdpContext(
  context: AsyncCdpContext,
): AsyncProfileReport['cdpAsyncContexts'][number] {
  return {
    source: context.source,
    proofLevel: context.proofLevel,
    ...(context.capturedAtMs !== undefined ? { capturedAtMs: context.capturedAtMs } : {}),
    frames: context.frames.map(toReportFrame),
    asyncStack: context.asyncStack.map((segment) => ({
      ...(segment.description ? { description: segment.description } : {}),
      frames: segment.frames.map(toReportFrame),
    })),
  };
}

function buildSummary(
  data: AsyncKindData,
  captureDurationMs: number,
  hotFiles: readonly AsyncHotFile[],
): AsyncSummary {
  const byKind: Partial<Record<AsyncOperationKindReport, number>> = {};
  const durations: number[] = [];
  for (const rec of data.records) {
    byKind[rec.kind] = (byKind[rec.kind] ?? 0) + 1;
    if (rec.durationMs !== undefined) durations.push(rec.durationMs);
  }
  durations.sort((a, b) => a - b);

  const concurrencyStats =
    data.concurrency.length > 0
      ? {
          meanInflight: mean(data.concurrency.map((s) => s.inflight)),
          maxInflight: data.concurrency.reduce((m, s) => Math.max(m, s.inflight), 0),
          meanActive: mean(data.concurrency.map((s) => s.active)),
          maxActive: data.concurrency.reduce((m, s) => Math.max(m, s.active), 0),
        }
      : undefined;

  const summary: AsyncSummary = {
    available: data.available,
    collectedVia: data.collectedVia,
    totalOperations: data.records.length,
    byKind,
    orphanCount: data.integrity.orphanCount,
    recordsDropped: data.integrity.recordsDropped,
  };
  const topHotFile = hotFiles[0];
  if (topHotFile) {
    summary.topAsyncHotFile = {
      function: topHotFile.primaryFrame.function,
      file: topHotFile.file,
      line: topHotFile.primaryFrame.line,
      score: topHotFile.score,
      confidence: topHotFile.confidence,
      ...(topHotFile.primaryFrame.source ? { source: topHotFile.primaryFrame.source } : {}),
      ...(topHotFile.userCaller ? { userCaller: topHotFile.userCaller } : {}),
    };
  }
  if (durations.length > 0) {
    summary.durationStats = {
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      maxMs: durations[durations.length - 1] ?? 0,
      meanMs: mean(durations),
    };
  }
  if (concurrencyStats) summary.concurrency = concurrencyStats;
  // Only completed operations have a real latency; orphans carry a fictional
  // capture-clamped duration that would corrupt the percentiles.
  const byKindLatency = buildByKindLatency(
    data.records.filter((rec) => !rec.orphan),
    captureDurationMs,
  );
  if (Object.keys(byKindLatency).length > 0) summary.byKindLatency = byKindLatency;
  return summary;
}

interface BuildTopOperationsArgs {
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
}

function buildTopOperations(args: BuildTopOperationsArgs): AsyncTopOperation[] {
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
  } = args;
  const out: AsyncTopOperation[] = [];
  for (const rec of sorted) {
    if (out.length >= MAX_TOP_OPERATIONS) break;
    const durationMs = effectiveDuration(rec, captureDurationMs);
    if (durationMs <= 0) continue;
    const initStack = rec.initStack.slice(0, MAX_INIT_STACK_FRAMES).map(toReportFrame);
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
      ? toReportFrame(rec.promiseRegistrationStack[0])
      : undefined;
    const promiseHandlerFrame = rec.promiseHandlerStack?.[0]
      ? toReportFrame(rec.promiseHandlerStack[0])
      : undefined;
    const awaitFrame = rec.awaitStack?.[0] ? toReportFrame(rec.awaitStack[0]) : undefined;
    const safeRegistrationFrame = rec.safeRegistrationStack?.[0]
      ? toReportFrame(rec.safeRegistrationStack[0])
      : undefined;
    const safeHandlerFrame = rec.safeHandlerStack?.[0]
      ? toReportFrame(rec.safeHandlerStack[0])
      : undefined;
    const executionFrame = rec.executionStack?.[0]
      ? toReportFrame(rec.executionStack[0])
      : undefined;
    const cdpAsyncStack = rec.cdpAsyncContext ? toReportCdpContext(rec.cdpAsyncContext) : undefined;
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
      op.userCaller = userCallerFromAsyncFrame(toReportFrame(attributed.frame), {
        profilePct: 0,
        supportPct: 100,
        confidence: 'low',
        basis: 'async-stack',
      });
    } else {
      op.userCaller = userCallerFromAsyncFrame(primaryFrame, {
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

function correlateCdpAsyncContexts(
  records: AsyncOperationRecord[],
  contexts: readonly AsyncCdpContext[],
): void {
  for (const context of contexts) {
    const frame = firstCdpAsyncContextFrame(context);
    let best: { record: AsyncOperationRecord; score: number } | undefined;
    for (const record of records) {
      const score = scoreCdpMatch(record, context, frame);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { record, score };
    }
    if (!best) continue;
    if (!best.record.cdpAsyncContext || best.score >= 60) {
      best.record.cdpAsyncContext = context;
    }
  }
}

function scoreCdpMatch(
  record: AsyncOperationRecord,
  context: AsyncCdpContext,
  frame: AsyncStackFrame | undefined,
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
      if (stack.some((candidate) => sameFrameFile(candidate, frame))) {
        score += 40;
        break;
      }
    }
  }
  if (record.kind === 'promise' && context.asyncStack.length > 0) score += 10;
  return score;
}

function sameFrameFile(left: AsyncStackFrame, right: AsyncStackFrame): boolean {
  return (
    normalizeFrameFile(left.file) === normalizeFrameFile(right.file) &&
    Math.abs(left.line - right.line) <= 2
  );
}

function buildChainTree(
  records: AsyncOperationRecord[],
  recordById: Map<number, AsyncOperationRecord>,
): Map<number, AsyncChainNode> {
  const nodes = new Map<number, AsyncChainNode>();
  for (const rec of records) {
    nodes.set(rec.asyncId, {
      asyncId: rec.asyncId,
      kind: rec.kind,
      rawType: rec.rawType,
      durationMs: rec.durationMs ?? 0,
      runMs: rec.runMs,
      initAtMs: rec.initAtMs,
      depth: 0,
      childIds: [],
      orphan: rec.orphan,
    });
  }
  for (const rec of records) {
    const parent = nodes.get(rec.triggerAsyncId);
    if (parent) parent.childIds.push(rec.asyncId);
  }
  const compute = (id: number, seen: Set<number>): number => {
    const node = nodes.get(id);
    if (!node) return 0;
    if (node.depth > 0) return node.depth;
    if (seen.has(id)) return node.depth;
    seen.add(id);
    const parentRec = recordById.get(id);
    if (!parentRec) return 0;
    const parentNode = nodes.get(parentRec.triggerAsyncId);
    if (!parentNode) {
      node.depth = 1;
      return 1;
    }
    node.depth = compute(parentRec.triggerAsyncId, seen) + 1;
    return node.depth;
  };
  for (const node of nodes.values()) compute(node.asyncId, new Set());
  return nodes;
}

function buildRootMap(
  records: AsyncOperationRecord[],
  recordById: Map<number, AsyncOperationRecord>,
): Map<number, number> {
  const rootByAsyncId = new Map<number, number>();
  const memo = new Map<number, number>();
  const findRoot = (asyncId: number, seen: Set<number>): number => {
    const memoized = memo.get(asyncId);
    if (memoized !== undefined) return memoized;
    if (seen.has(asyncId)) return asyncId;
    seen.add(asyncId);
    const rec = recordById.get(asyncId);
    if (!rec) return asyncId;
    if (!recordById.has(rec.triggerAsyncId)) {
      memo.set(asyncId, asyncId);
      return asyncId;
    }
    const root = findRoot(rec.triggerAsyncId, seen);
    memo.set(asyncId, root);
    return root;
  };
  for (const rec of records) rootByAsyncId.set(rec.asyncId, findRoot(rec.asyncId, new Set()));
  return rootByAsyncId;
}

function buildChains(
  nodes: Map<number, AsyncChainNode>,
  recordById: Map<number, AsyncOperationRecord>,
): AsyncChainSummary[] {
  const roots: AsyncChainNode[] = [];
  for (const node of nodes.values()) {
    const rec = recordById.get(node.asyncId);
    if (!rec) continue;
    if (!nodes.has(rec.triggerAsyncId)) roots.push(node);
  }

  const summaries: AsyncChainSummary[] = [];
  for (const root of roots) {
    let totalOps = 0;
    let totalDuration = 0;
    let maxDepth = 0;
    let deepestLeaf: AsyncChainNode = root;
    const fileCounts = new Map<string, number>();
    const stack: Array<{ node: AsyncChainNode; depthFromRoot: number }> = [
      { node: root, depthFromRoot: 0 },
    ];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) break;
      const { node, depthFromRoot } = next;
      if (seen.has(node.asyncId)) continue;
      seen.add(node.asyncId);
      totalOps += 1;
      totalDuration += node.durationMs;
      const frame = recordById.get(node.asyncId)?.initStack[0];
      if (frame) {
        const file = normalizeFrameFile(frame.file);
        fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
      }
      if (depthFromRoot > maxDepth) {
        maxDepth = depthFromRoot;
        deepestLeaf = node;
      }
      for (const childId of node.childIds) {
        const child = nodes.get(childId);
        if (child) stack.push({ node: child, depthFromRoot: depthFromRoot + 1 });
      }
    }
    if (totalOps <= 1) continue;
    const deepestPath = pathToRoot(deepestLeaf, nodes, recordById).map((n) => n.kind);
    const rootFrame = recordById.get(root.asyncId)?.initStack[0];
    const deepestFrame = recordById.get(deepestLeaf.asyncId)?.initStack[0];
    const dominantFile = [...fileCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0];
    const summary: AsyncChainSummary = {
      rootAsyncId: root.asyncId,
      rootKind: root.kind,
      depth: maxDepth,
      totalOperations: totalOps,
      totalDurationMs: totalDuration,
      deepestPath,
    };
    if (rootFrame) summary.rootFrame = toReportFrame(rootFrame);
    if (deepestFrame) summary.deepestFrame = toReportFrame(deepestFrame);
    if (dominantFile) summary.dominantFile = dominantFile;
    summaries.push(summary);
  }
  summaries.sort((a, b) => b.depth - a.depth || b.totalOperations - a.totalOperations);
  return summaries.slice(0, MAX_CHAINS);
}

function pathToRoot(
  leaf: AsyncChainNode,
  nodes: Map<number, AsyncChainNode>,
  recordById: Map<number, AsyncOperationRecord>,
): AsyncChainNode[] {
  const path: AsyncChainNode[] = [leaf];
  const seen = new Set<number>([leaf.asyncId]);
  let current: AsyncChainNode | undefined = leaf;
  while (current) {
    const rec = recordById.get(current.asyncId);
    if (!rec) break;
    const parent = nodes.get(rec.triggerAsyncId);
    if (!parent || seen.has(parent.asyncId)) break;
    path.unshift(parent);
    seen.add(parent.asyncId);
    current = parent;
  }
  return path;
}

function buildOrphans(records: AsyncOperationRecord[], captureDurationMs: number): AsyncOrphan[] {
  const orphans: AsyncOrphan[] = [];
  for (const rec of records) {
    if (!rec.orphan) continue;
    const ageMs = Math.max(0, captureDurationMs - rec.initAtMs);
    const initStack = rec.initStack.slice(0, MAX_INIT_STACK_FRAMES).map(toReportFrame);
    const o: AsyncOrphan = {
      asyncId: rec.asyncId,
      kind: rec.kind,
      rawType: rec.rawType,
      initAtMs: rec.initAtMs,
      ageMs,
      triggerAsyncId: rec.triggerAsyncId,
      initStack,
    };
    if (initStack[0]) o.initFrame = initStack[0];
    orphans.push(o);
  }
  orphans.sort((a, b) => b.ageMs - a.ageMs);
  return orphans.slice(0, MAX_ORPHANS);
}

interface BuildQualityArgs {
  data: AsyncKindData;
  cpuAttribution: AsyncCpuAttribution;
  recordById: Map<number, AsyncOperationRecord>;
  clockSyncUncertaintyMs: number;
  eventLoopSignalAvailable: boolean;
}

function buildQuality(args: BuildQualityArgs): AsyncProfileQuality {
  const { data, cpuAttribution, recordById, clockSyncUncertaintyMs, eventLoopSignalAvailable } =
    args;
  const operationCount = data.records.length;
  const recordsWithStacks = data.records.filter((rec) => rec.initStack.length > 0).length;
  const sampledStackRatio = operationCount > 0 ? recordsWithStacks / operationCount : 0;
  const attributedStackRatio =
    operationCount > 0
      ? data.records.filter((rec) => {
          const origin = resolveAttributedFrame(rec, recordById).origin;
          return origin === 'self' || origin === 'inherited-trigger';
        }).length / operationCount
      : 0;
  const cpuSamplesConsidered =
    cpuAttribution.cpuAttributedSamples + cpuAttribution.cpuAmbiguousSamples;
  const ambiguousRatio =
    cpuSamplesConsidered > 0 ? cpuAttribution.cpuAmbiguousSamples / cpuSamplesConsidered : 0;
  const cdpAsyncStackCoverageRatio =
    operationCount > 0 ? Math.min(1, (data.cdpAsyncContexts?.length ?? 0) / operationCount) : 0;
  const runWindowCount = data.records.reduce((sum, rec) => sum + rec.runWindows.length, 0);
  const reasons: string[] = [];
  const recommendations = new Set<string>();
  const attachPartialCapture = Boolean(data.attachPartialCapture);
  const instrumentationMode = data.instrumentationMode ?? 'safe';

  if (operationCount === 0) {
    reasons.push('no async operations were captured');
    recommendations.add('Capture during representative async activity.');
  }
  if (operationCount > 0 && sampledStackRatio < 1) {
    reasons.push(
      `only ${(sampledStackRatio * 100).toFixed(0)}% of async operations include init stacks`,
    );
    recommendations.add('Increase async stack depth for better file attribution.');
  }
  if (data.integrity.recordsDropped > 0) {
    reasons.push(
      `${data.integrity.recordsDropped} async records were dropped because maxRecords=${data.maxRecords} was reached`,
    );
    recommendations.add('Increase --async-max-events or shorten the capture window.');
  }
  if (data.collectedVia !== 'async-hooks') {
    reasons.push(`async_hooks data was not available; collection used ${data.collectedVia}`);
    recommendations.add('Use spawn mode or ensure the Lanterna preload can install async_hooks.');
  }
  if (attachPartialCapture) {
    reasons.push('attach mode can only observe async resources created after hooks were installed');
    recommendations.add('Use run mode for complete startup async lifecycle coverage.');
  }
  if (operationCount > 0 && !eventLoopSignalAvailable) {
    reasons.push(
      'event-loop signal was unavailable, so latency causes cannot distinguish a blocked loop from genuine I/O wait (such operations are reported as `unknown` with basis `no-eventloop-signal`)',
    );
    recommendations.add(
      'Capture in spawn mode (or ensure the event-loop heartbeat is available) to classify event-loop-blocked latency.',
    );
  }
  if (cpuAttribution.cpuAmbiguousSamples > 0) {
    reasons.push(
      `${cpuAttribution.cpuAmbiguousSamples} CPU samples overlapped multiple async run windows and were marked ambiguous`,
    );
    recommendations.add(
      'Treat CPU-to-async attribution as directional when async windows overlap.',
    );
  }
  if (clockSyncUncertaintyMs > 10) {
    reasons.push(
      `runtime/CDP clock synchronization uncertainty was ${clockSyncUncertaintyMs.toFixed(1)}ms`,
    );
  }
  if (cpuAttribution.available && runWindowCount === 0) {
    reasons.push('no async run windows were available for CPU attribution');
    recommendations.add(
      'Capture a workload where async resources execute during the profiling window.',
    );
  }
  if (instrumentationMode === 'full' && data.transformStats?.partial) {
    reasons.push(
      `full async instrumentation transformed ${data.transformStats.transformed} files, skipped ${data.transformStats.skipped}, and failed ${data.transformStats.failed}`,
    );
    recommendations.add(
      'Treat await-frame coverage as partial; ESM entrypoints and unparseable files may need a dedicated loader.',
    );
  }

  return {
    confidence: scoreAsyncConfidence({
      operationCount,
      sampledStackRatio,
      recordsDropped: data.integrity.recordsDropped,
      collectedVia: data.collectedVia,
      attachPartialCapture,
      cpuAmbiguousRatio: ambiguousRatio,
      fullTransformPartial: instrumentationMode === 'full' && Boolean(data.transformStats?.partial),
    }),
    instrumentationMode,
    attachPartialCapture,
    operationCount,
    sampledStackRatio,
    initStackCoverageRatio: sampledStackRatio,
    attributedStackRatio,
    cdpAsyncStackCoverageRatio,
    recordsDropped: data.integrity.recordsDropped,
    maxRecords: data.maxRecords,
    runWindowCount,
    cpuAttributionCoveragePct: cpuAttribution.attributedCpuPct,
    cpuAmbiguousSamples: cpuAttribution.cpuAmbiguousSamples,
    ambiguousRatio,
    clockSyncUncertaintyMs,
    reasons,
    recommendations: Array.from(recommendations),
  };
}

function scoreAsyncConfidence(input: {
  operationCount: number;
  sampledStackRatio: number;
  recordsDropped: number;
  collectedVia: AsyncKindData['collectedVia'];
  attachPartialCapture: boolean;
  cpuAmbiguousRatio: number;
  fullTransformPartial: boolean;
}): ProfileConfidence {
  if (input.attachPartialCapture || input.cpuAmbiguousRatio > 0.5 || input.fullTransformPartial) {
    return 'low';
  }
  if (
    input.operationCount > 0 &&
    input.sampledStackRatio >= 0.99 &&
    input.recordsDropped === 0 &&
    input.collectedVia === 'async-hooks'
  ) {
    return 'high';
  }
  if (
    input.operationCount > 0 &&
    input.sampledStackRatio >= 0.5 &&
    input.recordsDropped === 0 &&
    input.collectedVia === 'async-hooks'
  ) {
    return 'medium';
  }
  return 'low';
}

function buildHotFiles(args: {
  records: AsyncOperationRecord[];
  captureDurationMs: number;
  chainNodes: Map<number, AsyncChainNode>;
  rootByAsyncId: Map<number, number>;
  cpuAttribution: AsyncCpuAttribution;
  quality: AsyncProfileQuality;
}): AsyncHotFile[] {
  const { records, captureDurationMs, chainNodes, rootByAsyncId, cpuAttribution, quality } = args;
  interface HotFileAggregate {
    file: string;
    operationCount: number;
    totalDurationMs: number;
    orphanCount: number;
    maxOrphanAgeMs: number;
    maxChainDepth: number;
    cpuPct: number;
    runMs: number;
    kindBreakdown: Partial<Record<AsyncOperationKindReport, number>>;
    sampleAsyncIds: number[];
    frames: Map<string, { frame: AsyncStackFrameReport; count: number; durationMs: number }>;
  }
  const byFile = new Map<string, HotFileAggregate>();
  const cpuPctByFile = new Map<string, number>();
  for (const entry of cpuAttribution.topChains) {
    if (!entry.rootFrame) continue;
    const file = normalizeFrameFile(entry.rootFrame.file);
    cpuPctByFile.set(file, (cpuPctByFile.get(file) ?? 0) + entry.cpuPct);
  }

  for (const rec of records) {
    const frame = rec.initStack[0];
    if (!frame) continue;
    const file = normalizeFrameFile(frame.file);
    const durationMs = effectiveDuration(rec, captureDurationMs);
    const ageMs = rec.orphan ? Math.max(0, captureDurationMs - rec.initAtMs) : 0;
    const aggregate = byFile.get(file) ?? {
      file,
      operationCount: 0,
      totalDurationMs: 0,
      orphanCount: 0,
      maxOrphanAgeMs: 0,
      maxChainDepth: 0,
      cpuPct: 0,
      runMs: 0,
      kindBreakdown: {},
      sampleAsyncIds: [],
      frames: new Map<
        string,
        { frame: AsyncStackFrameReport; count: number; durationMs: number }
      >(),
    };
    aggregate.operationCount += 1;
    aggregate.totalDurationMs += durationMs;
    aggregate.orphanCount += rec.orphan ? 1 : 0;
    aggregate.maxOrphanAgeMs = Math.max(aggregate.maxOrphanAgeMs, ageMs);
    aggregate.maxChainDepth = Math.max(
      aggregate.maxChainDepth,
      chainNodes.get(rec.asyncId)?.depth ?? 0,
    );
    aggregate.runMs += rec.runMs;
    aggregate.kindBreakdown[rec.kind] = (aggregate.kindBreakdown[rec.kind] ?? 0) + 1;
    if (aggregate.sampleAsyncIds.length < MAX_HOT_FILE_SAMPLE_IDS) {
      aggregate.sampleAsyncIds.push(rec.asyncId);
    }
    const reportFrame = toReportFrame(frame);
    const frameKey = `${reportFrame.file}:${reportFrame.line}:${reportFrame.function}`;
    const frameAggregate = aggregate.frames.get(frameKey);
    if (frameAggregate) {
      frameAggregate.count += 1;
      frameAggregate.durationMs += durationMs;
    } else {
      aggregate.frames.set(frameKey, { frame: reportFrame, count: 1, durationMs });
    }
    byFile.set(file, aggregate);

    const rootId = rootByAsyncId.get(rec.asyncId);
    const rootFrame = rootId
      ? records.find((candidate) => candidate.asyncId === rootId)?.initStack[0]
      : undefined;
    if (rootFrame && normalizeFrameFile(rootFrame.file) !== file) {
      cpuPctByFile.set(file, cpuPctByFile.get(file) ?? 0);
    }
  }

  const hotFiles: AsyncHotFile[] = [];
  for (const aggregate of byFile.values()) {
    aggregate.cpuPct = cpuPctByFile.get(aggregate.file) ?? 0;
    const primary = [...aggregate.frames.values()].sort(
      (a, b) => b.durationMs - a.durationMs || b.count - a.count || a.frame.line - b.frame.line,
    )[0];
    if (!primary) continue;
    const score =
      aggregate.totalDurationMs +
      aggregate.runMs +
      aggregate.orphanCount * 100 +
      aggregate.maxChainDepth * 10 +
      aggregate.cpuPct * 5;
    const userCaller = userCallerFromAsyncFrame(primary.frame, {
      profilePct: aggregate.cpuPct,
      supportPct: 100,
      confidence: confidenceForHotFile(quality, aggregate.operationCount),
      basis: 'async-stack',
    });
    hotFiles.push({
      file: aggregate.file,
      score,
      confidence: confidenceForHotFile(quality, aggregate.operationCount),
      primaryFrame: primary.frame,
      operationCount: aggregate.operationCount,
      totalDurationMs: aggregate.totalDurationMs,
      orphanCount: aggregate.orphanCount,
      maxOrphanAgeMs: aggregate.maxOrphanAgeMs,
      maxChainDepth: aggregate.maxChainDepth,
      cpuPct: aggregate.cpuPct,
      runMs: aggregate.runMs,
      kindBreakdown: aggregate.kindBreakdown,
      sampleAsyncIds: aggregate.sampleAsyncIds,
      ...(userCaller ? { userCaller } : {}),
    });
  }
  hotFiles.sort(
    (a, b) =>
      b.score - a.score || b.operationCount - a.operationCount || a.file.localeCompare(b.file),
  );
  return hotFiles.slice(0, MAX_HOT_FILES);
}

function confidenceForHotFile(
  quality: AsyncProfileQuality,
  operationCount: number,
): ProfileConfidence {
  if (quality.confidence === 'low') return 'low';
  if (quality.confidence === 'high' && operationCount > 0) return 'high';
  return 'medium';
}

interface BuildAttributionArgs {
  records: AsyncOperationRecord[];
  recordById: Map<number, AsyncOperationRecord>;
  rootByAsyncId: Map<number, number>;
  chainNodes: Map<number, AsyncChainNode>;
  cpuKind: { cpuProfile: RawCpuProfile } | undefined;
  /** Real clock-alignment uncertainty (CDP jitter / perf.now resolution) to report. */
  clockSyncUncertaintyMs: number;
}

/**
 * Attributes CPU samples to async chain roots by overlapping each sample's
 * timestamp with the `(before, after)` run windows recorded by the preload
 * hook. Both clocks are V8 `performance.now()`-based so the absolute drift
 * is small (a few ms) — fine for aggregate attribution.
 *
 * Returns a degraded report (`available: false`) when CPU was not captured,
 * the CPU profile lacks per-sample timestamps, or no run windows exist.
 */
function buildCpuAttribution(args: BuildAttributionArgs): AsyncCpuAttribution {
  const { records, recordById, rootByAsyncId, chainNodes, cpuKind } = args;
  if (!cpuKind) {
    return emptyAttribution('cpu kind not captured');
  }
  const cpuProfile = cpuKind.cpuProfile;
  const samples = cpuProfile.samples;
  const deltas = cpuProfile.timeDeltas;
  if (!samples || !deltas || samples.length === 0 || samples.length !== deltas.length) {
    return emptyAttribution('CPU profile has no per-sample timestamps');
  }
  // Run-window total → if zero, nothing to attribute.
  let totalWindows = 0;
  for (const rec of records) totalWindows += rec.runWindows.length;
  if (totalWindows === 0) {
    return emptyAttribution('no async run windows recorded');
  }

  // Build a flat sorted list of (start, end, root), then sweep samples and
  // windows together. When windows overlap, choose the latest-starting active
  // window, matching the historical deterministic tie-break.
  interface Window {
    startMs: number;
    endMs: number;
    rootId: number;
    asyncId: number;
    order: number;
  }
  const windows: Window[] = [];
  let order = 0;
  for (const rec of records) {
    const root = rootByAsyncId.get(rec.asyncId) ?? rec.asyncId;
    for (const w of rec.runWindows) {
      windows.push({
        startMs: w.startMs,
        endMs: w.endMs,
        rootId: root,
        asyncId: rec.asyncId,
        order,
      });
      order += 1;
    }
  }
  windows.sort((a, b) => a.startMs - b.startMs || a.order - b.order);

  // Compute sample timestamps in ms relative to capture start. The CPU
  // profile timestamps are in microseconds; `startTime` anchors them.
  // NOTE: the CPU sampler and the async-hooks installer use the same V8
  // monotonic clock but with slightly different zero-points (Profiler.start
  // vs. captureStartMs in the preload). The skew is typically tens of ms
  // and is accepted as inherent imprecision; run-window granularity is ms
  // and the attribution is statistical, not exact.
  const sampleIntervalMs = mean(deltas) / 1000 || 1;
  let cursorUs = 0;
  let windowCursor = 0;
  let activeWindows: Window[] = [];
  let attributedCount = 0;
  let ambiguousCount = 0;
  const nodeById = new Map(cpuProfile.nodes.map((node) => [node.id, node]));
  const cpuByRoot = new Map<
    number,
    {
      cpuMs: number;
      contributingAsyncIds: Set<number>;
      sampleNodeIds: number[];
      frameCounts: Map<string, { frame: AsyncStackFrame; count: number }>;
    }
  >();
  const attributedSamplesByAsyncId = new Map<number, number>();
  for (let i = 0; i < samples.length; i += 1) {
    cursorUs += deltas[i] ?? 0;
    const tMs = cursorUs / 1000;
    while (windowCursor < windows.length && (windows[windowCursor]?.startMs ?? Infinity) <= tMs) {
      const next = windows[windowCursor];
      if (next) activeWindows.push(next);
      windowCursor += 1;
    }
    activeWindows = activeWindows.filter((w) => w.endMs >= tMs);
    let win: Window | undefined;
    if (activeWindows.length > 1) {
      // Overlapping windows from one ancestor/descendant chain belong to the
      // innermost (deepest) async context; only unrelated concurrent chains
      // are genuinely ambiguous.
      win = resolveOverlappingWindow(activeWindows, recordById, chainNodes);
      if (!win) {
        ambiguousCount += 1;
        continue;
      }
    } else {
      win = findLatestStartedWindow(activeWindows);
    }
    if (!win) continue;
    attributedCount += 1;
    const bucket = cpuByRoot.get(win.rootId) ?? {
      cpuMs: 0,
      contributingAsyncIds: new Set<number>(),
      sampleNodeIds: [],
      frameCounts: new Map<string, { frame: AsyncStackFrame; count: number }>(),
    };
    bucket.cpuMs += sampleIntervalMs;
    bucket.contributingAsyncIds.add(win.asyncId);
    bucket.sampleNodeIds.push(samples[i] ?? 0);
    attributedSamplesByAsyncId.set(
      win.asyncId,
      (attributedSamplesByAsyncId.get(win.asyncId) ?? 0) + 1,
    );
    const frame = cpuFrameForNode(nodeById.get(samples[i] ?? -1));
    if (frame) {
      const key = `${normalizeFrameFile(frame.file)}:${frame.line}:${frame.column}:${frame.function}`;
      const current = bucket.frameCounts.get(key);
      if (current) current.count += 1;
      else bucket.frameCounts.set(key, { frame, count: 1 });
    }
    cpuByRoot.set(win.rootId, bucket);
  }

  for (const [asyncId, count] of attributedSamplesByAsyncId) {
    const rec = recordById.get(asyncId);
    if (!rec) continue;
    rec.cpuAttributedSamples = count;
    rec.cpuAmbiguousSamples = ambiguousCount;
  }

  const totalCpuMs = samples.length * sampleIntervalMs;
  const attributedCpuPct =
    totalCpuMs > 0 ? (attributedCount * sampleIntervalMs * 100) / totalCpuMs : 0;
  const samplesConsidered = attributedCount + ambiguousCount;
  const ambiguousRatio = samplesConsidered > 0 ? ambiguousCount / samplesConsidered : 0;
  const executionConfidence: ProfileConfidence =
    ambiguousRatio < 0.1 ? 'high' : ambiguousRatio < 0.33 ? 'medium' : 'low';

  const topChains: AsyncCpuAttributionEntry[] = [];
  for (const [rootId, bucket] of cpuByRoot.entries()) {
    const root = recordById.get(rootId);
    if (!root) continue;
    const cpuPct = totalCpuMs > 0 ? (bucket.cpuMs * 100) / totalCpuMs : 0;
    const entry: AsyncCpuAttributionEntry = {
      rootAsyncId: rootId,
      rootKind: root.kind,
      cpuPct,
      cpuMs: bucket.cpuMs,
      contributingOperations: bucket.contributingAsyncIds.size,
    };
    if (root.initStack[0]) entry.rootFrame = toReportFrame(root.initStack[0]);
    const executionFrame = bestCpuFrame(bucket.frameCounts);
    if (executionFrame) {
      const reportFrame = toReportFrame(executionFrame);
      entry.executionFrame = reportFrame;
      entry.executionConfidence = executionConfidence;
      root.executionStack = [executionFrame];
      root.executionConfidence = entry.executionConfidence;
      root.cpuAttributedSamples = bucket.sampleNodeIds.length;
      root.cpuAmbiguousSamples = ambiguousCount;
    }
    const callerFrame = entry.executionFrame ?? entry.rootFrame;
    const basis = entry.executionFrame ? 'async-cpu-window' : 'async-stack';
    const confidence = entry.executionFrame ? (entry.executionConfidence ?? 'medium') : 'medium';
    const userCaller = userCallerFromAsyncFrame(callerFrame, {
      profilePct: cpuPct,
      supportPct: 100,
      confidence,
      basis,
    });
    if (userCaller) entry.userCaller = userCaller;
    topChains.push(entry);
  }
  topChains.sort((a, b) => b.cpuPct - a.cpuPct);
  return {
    available: true,
    attributedCpuPct,
    totalCpuMs,
    cpuAttributedSamples: attributedCount,
    cpuAmbiguousSamples: ambiguousCount,
    clockSyncUncertaintyMs: args.clockSyncUncertaintyMs,
    topChains: topChains.slice(0, MAX_CPU_ATTRIBUTION_CHAINS),
  };
}

function cpuFrameForNode(
  node: RawCpuProfile['nodes'][number] | undefined,
): AsyncStackFrame | undefined {
  const callFrame = node?.callFrame;
  if (!callFrame?.url) return undefined;
  if (callFrame.url.startsWith('node:') || callFrame.url.includes('/node_modules/')) {
    return undefined;
  }
  return {
    function: callFrame.functionName || '<anonymous>',
    file: callFrame.url,
    line: Math.max(0, callFrame.lineNumber + 1),
    column: Math.max(0, callFrame.columnNumber + 1),
  };
}

function bestCpuFrame(
  counts: Map<string, { frame: AsyncStackFrame; count: number }>,
): AsyncStackFrame | undefined {
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.frame.file.localeCompare(b.frame.file),
  )[0]?.frame;
}

function findLatestStartedWindow<Window extends { startMs: number; order: number }>(
  windows: readonly Window[],
): Window | undefined {
  let best: Window | undefined;
  for (const window of windows) {
    if (
      !best ||
      window.startMs > best.startMs ||
      (window.startMs === best.startMs && window.order > best.order)
    ) {
      best = window;
    }
  }
  return best;
}

function emptyAttribution(reason: string): AsyncCpuAttribution {
  return {
    available: false,
    reason,
    attributedCpuPct: 0,
    totalCpuMs: 0,
    cpuAttributedSamples: 0,
    cpuAmbiguousSamples: 0,
    clockSyncUncertaintyMs: 0,
    topChains: [],
  };
}

/** True when `ancestorId` is `descendantId` or one of its trigger ancestors. */
function isAsyncAncestor(
  ancestorId: number,
  descendantId: number,
  recordById: Map<number, AsyncOperationRecord>,
  maxHops = 256,
): boolean {
  if (ancestorId === descendantId) return true;
  const seen = new Set<number>();
  let current = recordById.get(descendantId);
  let hops = 0;
  while (current && !seen.has(current.asyncId) && hops < maxHops) {
    seen.add(current.asyncId);
    if (current.triggerAsyncId === ancestorId) return true;
    current = recordById.get(current.triggerAsyncId);
    hops += 1;
  }
  return false;
}

/**
 * When several run windows overlap a CPU sample, attribute it to the innermost
 * (deepest) async context — but only if all active windows lie on a single
 * ancestor/descendant chain. Unrelated concurrent chains return undefined so
 * the caller marks the sample ambiguous.
 */
function resolveOverlappingWindow<W extends { asyncId: number; order: number }>(
  windows: readonly W[],
  recordById: Map<number, AsyncOperationRecord>,
  chainNodes: Map<number, AsyncChainNode>,
): W | undefined {
  let deepest = windows[0];
  if (!deepest) return undefined;
  for (const w of windows) {
    const depth = chainNodes.get(w.asyncId)?.depth ?? 0;
    const bestDepth = chainNodes.get(deepest.asyncId)?.depth ?? 0;
    if (depth > bestDepth || (depth === bestDepth && w.order > deepest.order)) deepest = w;
  }
  for (const w of windows) {
    if (w.asyncId === deepest.asyncId) continue;
    if (!isAsyncAncestor(w.asyncId, deepest.asyncId, recordById)) return undefined;
  }
  return deepest;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx] ?? 0;
}
