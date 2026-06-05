import type { RawCpuProfile } from '../../../capture/core/types.js';
import type {
  AsyncCpuAttribution,
  AsyncCpuAttributionEntry,
  ProfileConfidence,
} from '../../../report/types.js';
import type { AsyncChainNode, AsyncOperationRecord, AsyncStackFrame } from '../types.js';
import type { AsyncFrameReporter } from './frames.js';

const MAX_CPU_ATTRIBUTION_CHAINS = 10;

export interface BuildAttributionArgs {
  records: AsyncOperationRecord[];
  recordById: Map<number, AsyncOperationRecord>;
  rootByAsyncId: Map<number, number>;
  chainNodes: Map<number, AsyncChainNode>;
  cpuKind: { cpuProfile: RawCpuProfile } | undefined;
  /** Real clock-alignment uncertainty (CDP jitter / perf.now resolution) to report. */
  clockSyncUncertaintyMs: number;
  frameReporter: AsyncFrameReporter;
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
export function buildCpuAttribution(args: BuildAttributionArgs): AsyncCpuAttribution {
  const { records, recordById, rootByAsyncId, chainNodes, cpuKind, frameReporter } = args;
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
    for (const window of rec.runWindows) {
      windows.push({
        startMs: window.startMs,
        endMs: window.endMs,
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
    activeWindows = activeWindows.filter((window) => window.endMs >= tMs);
    let window: Window | undefined;
    if (activeWindows.length > 1) {
      // Overlapping windows from one ancestor/descendant chain belong to the
      // innermost (deepest) async context; only unrelated concurrent chains
      // are genuinely ambiguous.
      window = resolveOverlappingWindow(activeWindows, recordById, chainNodes);
      if (!window) {
        ambiguousCount += 1;
        continue;
      }
    } else {
      window = findLatestStartedWindow(activeWindows);
    }
    if (!window) continue;
    attributedCount += 1;
    const bucket = cpuByRoot.get(window.rootId) ?? {
      cpuMs: 0,
      contributingAsyncIds: new Set<number>(),
      sampleNodeIds: [],
      frameCounts: new Map<string, { frame: AsyncStackFrame; count: number }>(),
    };
    bucket.cpuMs += sampleIntervalMs;
    bucket.contributingAsyncIds.add(window.asyncId);
    bucket.sampleNodeIds.push(samples[i] ?? 0);
    attributedSamplesByAsyncId.set(
      window.asyncId,
      (attributedSamplesByAsyncId.get(window.asyncId) ?? 0) + 1,
    );
    const frame = cpuFrameForNode(nodeById.get(samples[i] ?? -1));
    if (frame) {
      const key = `${frameReporter.normalizeFrameFile(frame.file)}:${frame.line}:${frame.column}:${frame.function}`;
      const current = bucket.frameCounts.get(key);
      if (current) current.count += 1;
      else bucket.frameCounts.set(key, { frame, count: 1 });
    }
    cpuByRoot.set(window.rootId, bucket);
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
    const rootOriginFrame = frameReporter.firstNonNoiseFrame(root.initStack);
    if (rootOriginFrame) entry.rootFrame = frameReporter.toReportFrame(rootOriginFrame);
    const executionFrame = bestCpuFrame(bucket.frameCounts, frameReporter);
    if (executionFrame) {
      const reportFrame = frameReporter.toReportFrame(executionFrame);
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
    const userCaller = frameReporter.userCallerFromAsyncFrame(callerFrame, {
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
  frameReporter: AsyncFrameReporter,
): AsyncStackFrame | undefined {
  // Pick the hottest frame that is not Lanterna's own instrumentation: the async
  // hooks themselves burn CPU and can out-sample the user code they wrap, but
  // reporting the preload as the execution frame points at the profiler. When
  // every sampled frame is instrumentation there is no real user execution
  // frame — return undefined so the chain falls back to its root frame.
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.frame.file.localeCompare(b.frame.file))
    .map((entry) => entry.frame)
    .find((frame) => !frameReporter.isInstrumentationFrame(frame));
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
  for (const window of windows) {
    const depth = chainNodes.get(window.asyncId)?.depth ?? 0;
    const bestDepth = chainNodes.get(deepest.asyncId)?.depth ?? 0;
    if (depth > bestDepth || (depth === bestDepth && window.order > deepest.order)) {
      deepest = window;
    }
  }
  for (const window of windows) {
    if (window.asyncId === deepest.asyncId) continue;
    if (!isAsyncAncestor(window.asyncId, deepest.asyncId, recordById)) return undefined;
  }
  return deepest;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}
