import { classifyFrame } from '../../analysis/model/classify.js';
import { isNoiseCategory, shouldKeepNoiseFrames } from '../../analysis/noise-filters.js';
import type { SourceMapResolver } from '../../analysis/sourcemap/resolver.js';
import type {
  RawSamplingHeapProfile,
  RawSamplingHeapProfileNode,
} from '../../capture/core/heap.js';
import type { CaptureBundle } from '../../capture/core/types.js';
import type {
  FrameCategory,
  MemoryHotAllocator,
  MemoryProfileQuality,
  MemoryProfileReport,
  MemorySeriesStats,
  MemorySummary,
  MemoryUsageSample,
  SourceLocation,
  UserCallerAttribution,
} from '../../report/types.js';
import type { KindAnalysisContext, KindAnalysisContributor } from '../core/types.js';
import {
  buildHeapSnapshotAnalysisReport,
  type HeapSnapshotAnalysisReport,
  type NormalizedHeapSnapshotAnalysisOptions,
} from './heap-snapshot-analysis.js';
import type { MemoryKindData } from './probe.js';

const MAX_PUBLIC_HOT_ALLOCATORS = 50;

export interface MemoryAnalysisOptions {
  includeMemoryUsageSamples?: boolean;
  heapSnapshotAnalysis?: NormalizedHeapSnapshotAnalysisOptions;
}

/**
 * View exposed to analyzers via `context.forKind('memory')`. Lets memory
 * detectors reach the heap aggregates and the memoryUsage time series without
 * recomputing.
 */
export interface MemoryAnalysisView {
  data: MemoryKindData;
  bundle: CaptureBundle;
  hotAllocators: MemoryHotAllocator[];
  /** Total bytes summed across the sampling profile. */
  totalSampledBytes: number;
  /** Series stats keyed by metric name. Undefined when the series is empty. */
  series: {
    rss?: MemorySeriesStats;
    heapUsed?: MemorySeriesStats;
    external?: MemorySeriesStats;
    arrayBuffers?: MemorySeriesStats;
  };
}

declare module '../core/types.js' {
  interface KindViews {
    memory: MemoryAnalysisView;
  }
}

export function createMemoryAnalysisContributor(
  options: MemoryAnalysisOptions = {},
): KindAnalysisContributor<MemoryKindData> {
  return {
    analyze(ctx: KindAnalysisContext<MemoryKindData>) {
      const { data, bundle } = ctx;
      const aggregates = aggregateAllocators(
        data.samplingProfile,
        bundle.target.cwd,
        ctx.options.sourceMaps,
      );
      const totalSampledBytes = aggregates.totalSelfBytes;

      const hotAllocators = buildHotAllocators(aggregates, totalSampledBytes);
      const series = computeSeriesStats(data.memoryUsage.samples, bundle.durationMs);

      const summary: MemorySummary = {
        totalSampledBytes,
        samplingIntervalBytes: data.samplingIntervalBytes,
        ...(series.rss ? { rss: series.rss } : {}),
        ...(series.heapUsed ? { heapUsed: series.heapUsed } : {}),
        ...(series.external ? { external: series.external } : {}),
        ...(series.arrayBuffers ? { arrayBuffers: series.arrayBuffers } : {}),
        ...(hotAllocators[0]
          ? {
              topAllocator: {
                function: hotAllocators[0].function,
                file: hotAllocators[0].file,
                line: hotAllocators[0].line,
                selfPct: hotAllocators[0].selfPct,
                totalPct: hotAllocators[0].totalPct,
                ...(hotAllocators[0].source ? { source: hotAllocators[0].source } : {}),
                ...(hotAllocators[0].userCaller ? { userCaller: hotAllocators[0].userCaller } : {}),
              },
            }
          : {}),
        ...(series.heapUsed && series.external && series.arrayBuffers
          ? {
              externalRatio: safeRatio(series.external.meanBytes, series.heapUsed.meanBytes),
            }
          : {}),
      };

      const heapSnapshotAnalysis = resolveHeapSnapshotAnalysisReport(
        data.heapSnapshotAnalysis,
        options.heapSnapshotAnalysis,
      );
      const quality = buildMemoryQuality(data, totalSampledBytes, heapSnapshotAnalysis);

      const report: MemoryProfileReport = {
        summary,
        hotAllocators: hotAllocators.slice(0, MAX_PUBLIC_HOT_ALLOCATORS),
        quality,
        memoryUsage: {
          available: data.memoryUsage.available,
          sampleIntervalMs: data.memoryUsage.sampleIntervalMs || 0,
          sampleCount: data.memoryUsage.samples.length,
          ...(data.memoryUsage.samples[0] ? { firstSample: data.memoryUsage.samples[0] } : {}),
          ...(data.memoryUsage.samples.at(-1)
            ? { lastSample: data.memoryUsage.samples.at(-1) }
            : {}),
          ...(options.includeMemoryUsageSamples ? { samples: data.memoryUsage.samples } : {}),
        },
        ...(heapSnapshotAnalysis ? { heapSnapshotAnalysis } : {}),
      };

      ctx.writeSection<MemoryProfileReport>(report);

      const view: MemoryAnalysisView = {
        data,
        bundle,
        hotAllocators,
        totalSampledBytes,
        series,
      };
      ctx.setContextView<MemoryAnalysisView>(view);
    },
  };
}

function buildMemoryQuality(
  data: MemoryKindData,
  totalSampledBytes: number,
  heapSnapshotAnalysis: HeapSnapshotAnalysisReport | undefined,
): MemoryProfileQuality {
  const reasons: string[] = [];
  const recommendations = new Set<string>();
  const memorySampleCount = data.memoryUsage.samples.length;

  if (!data.memoryUsage.available || memorySampleCount === 0) {
    reasons.push('process.memoryUsage() samples were unavailable');
    recommendations.add(
      'Keep the target alive until finalization or use spawn mode so live memory samples can be preserved.',
    );
  }

  if (data.heapSamplingAvailable === false) {
    reasons.push('V8 heap sampling profile was unavailable');
    recommendations.add('Rerun the capture while the target process remains reachable over CDP.');
  } else if (totalSampledBytes === 0) {
    reasons.push(
      'V8 heap sampling profile contains 0 bytes — the probe ran but observed no heap allocations during the capture window',
    );
    recommendations.add(
      'Increase --duration, generate representative load (use --workload), or check that the target actually allocates on the V8 heap (Buffer.alloc and other external allocations are not visible to the heap sampler).',
    );
  }

  for (const warning of data.warnings ?? []) {
    reasons.push(warning);
  }

  if (heapSnapshotAnalysis && !heapSnapshotAnalysis.available) {
    reasons.push('heap snapshot analysis was unavailable');
    if (heapSnapshotAnalysis.warnings.length > 0) {
      reasons.push(...heapSnapshotAnalysis.warnings);
    }
    recommendations.add(
      'Use profiles.memory.hotAllocators and memoryUsage as the primary evidence when heap snapshots are unavailable.',
    );
  }

  const hasHeapSampling = data.heapSamplingAvailable !== false && totalSampledBytes > 0;
  const hasMemoryUsage = data.memoryUsage.available && memorySampleCount > 0;
  const confidence: MemoryProfileQuality['confidence'] =
    hasHeapSampling && hasMemoryUsage
      ? 'high'
      : hasHeapSampling || hasMemoryUsage
        ? 'medium'
        : 'low';

  return {
    confidence,
    reasons,
    recommendations: Array.from(recommendations),
  };
}

function resolveHeapSnapshotAnalysisReport(
  capturedOrReport: MemoryKindData['heapSnapshotAnalysis'] | HeapSnapshotAnalysisReport | undefined,
  options: NormalizedHeapSnapshotAnalysisOptions | undefined,
): HeapSnapshotAnalysisReport | undefined {
  if (!capturedOrReport) return undefined;
  if ('summary' in capturedOrReport) return capturedOrReport;
  if (!options?.enabled) return undefined;
  return buildHeapSnapshotAnalysisReport(capturedOrReport, options);
}

interface AllocatorAggregate {
  id: string;
  function: string;
  file: string;
  line: number;
  column: number;
  category: FrameCategory;
  package?: string;
  selfBytes: number;
  totalBytes: number;
  userCallerBytes: Map<string, number>;
  source?: SourceLocation;
}

interface AggregateResult {
  byId: Map<string, AllocatorAggregate>;
  callerById: Map<string, AllocatorCaller>;
  totalSelfBytes: number;
}

interface AllocatorCaller {
  function: string;
  file: string;
  line: number;
  column: number;
  source?: SourceLocation;
}

interface ClassifiedHeapFrame extends AllocatorCaller {
  id: string;
  category: FrameCategory;
  package?: string;
}

function aggregateAllocators(
  profile: RawSamplingHeapProfile,
  cwd: string,
  sourceMaps?: SourceMapResolver,
): AggregateResult {
  const byId = new Map<string, AllocatorAggregate>();
  const callerById = new Map<string, AllocatorCaller>();
  let totalSelfBytes = 0;

  if (sourceMaps) {
    const uniqueUrls = new Set<string>();
    const collect = (node: RawSamplingHeapProfileNode): void => {
      if (node.callFrame.url) uniqueUrls.add(node.callFrame.url);
      for (const child of node.children) collect(child);
    };
    collect(profile.head);
    sourceMaps.prepare(uniqueUrls);
  }

  // Walk: post-order accumulation of subtree size into `totalBytes`, summing
  // self into the per-frame aggregate keyed by (file, function, line, column).
  const walk = (
    node: RawSamplingHeapProfileNode,
    userAncestor: ClassifiedHeapFrame | undefined,
  ): number => {
    let subtreeSize = node.selfSize;
    const frame = classifyHeapFrame(node, cwd, sourceMaps);
    const nextUserAncestor = frame.category === 'user' ? frame : userAncestor;

    for (const child of node.children) subtreeSize += walk(child, nextUserAncestor);

    const existing = byId.get(frame.id);
    if (existing) {
      existing.selfBytes += node.selfSize;
      existing.totalBytes += subtreeSize;
      if (!existing.source && frame.source) existing.source = frame.source;
    } else {
      const aggregate: AllocatorAggregate = {
        id: frame.id,
        function: frame.function,
        file: frame.file,
        line: frame.line,
        column: frame.column,
        category: frame.category,
        ...(frame.package ? { package: frame.package } : {}),
        selfBytes: node.selfSize,
        totalBytes: subtreeSize,
        userCallerBytes: new Map(),
      };
      if (frame.source) aggregate.source = frame.source;
      byId.set(frame.id, aggregate);
    }
    const aggregate = byId.get(frame.id);
    if (aggregate && frame.category !== 'user' && nextUserAncestor && node.selfSize > 0) {
      callerById.set(nextUserAncestor.id, {
        function: nextUserAncestor.function,
        file: nextUserAncestor.file,
        line: nextUserAncestor.line,
        column: nextUserAncestor.column,
        ...(nextUserAncestor.source ? { source: nextUserAncestor.source } : {}),
      });
      aggregate.userCallerBytes.set(
        nextUserAncestor.id,
        (aggregate.userCallerBytes.get(nextUserAncestor.id) ?? 0) + node.selfSize,
      );
    }
    totalSelfBytes += node.selfSize;
    return subtreeSize;
  };

  walk(profile.head, undefined);
  return { byId, callerById, totalSelfBytes };
}

function classifyHeapFrame(
  node: RawSamplingHeapProfileNode,
  cwd: string,
  sourceMaps?: SourceMapResolver,
): ClassifiedHeapFrame {
  const cf = node.callFrame;
  const functionName = cf.functionName || '(anonymous)';
  const classified = classifyFrame(functionName, cf.url || '', cwd);
  // V8 emits 0-indexed line/column; the rest of the report uses 1-indexed
  // numbers (see `enrichCpuTree`), so normalize here for cross-kind keying.
  const line = cf.lineNumber + 1;
  const column = cf.columnNumber + 1;
  const frame: ClassifiedHeapFrame = {
    id: `${classified.file}:${line}:${column}:${functionName}`,
    function: functionName,
    file: classified.file,
    line,
    column,
    category: classified.category,
    ...(classified.package ? { package: classified.package } : {}),
  };
  if (sourceMaps && cf.url) {
    const resolved = sourceMaps.resolve(cf.url, line, column);
    if (resolved) frame.source = resolved;
  }
  return frame;
}

function buildHotAllocators(
  aggregates: AggregateResult,
  totalSampledBytes: number,
): MemoryHotAllocator[] {
  const denom = totalSampledBytes > 0 ? totalSampledBytes : 1;
  const keepNoise = shouldKeepNoiseFrames();
  const allocators: MemoryHotAllocator[] = [];
  for (const agg of aggregates.byId.values()) {
    if (agg.selfBytes === 0 && agg.totalBytes === 0) continue;
    // Skip the synthetic V8 root frame — it carries no actionable signal,
    // only the rolled-up subtree total.
    if (agg.function === '(root)') continue;
    // Profiler instrumentation (preload, runtime-signals hooks) allocates
    // inside the target process; the noise registry lets us drop those
    // frames so hot allocators describe the user's app, not the profiler.
    if (isNoiseCategory(agg.category) && !keepNoise) continue;
    const userCaller = buildAllocatorUserCaller(agg, aggregates, denom);
    allocators.push({
      id: agg.id,
      function: agg.function,
      file: agg.file,
      line: agg.line,
      column: agg.column,
      category: agg.category,
      ...(agg.package ? { package: agg.package } : {}),
      selfBytes: agg.selfBytes,
      selfPct: (agg.selfBytes * 100) / denom,
      totalBytes: agg.totalBytes,
      totalPct: (agg.totalBytes * 100) / denom,
      ...(agg.source ? { source: agg.source } : {}),
      ...(userCaller ? { userCaller } : {}),
    });
  }
  // Match detector relevance: inclusive-heavy allocator parents should stay
  // visible even when their exclusive allocation is small.
  allocators.sort(
    (a, b) =>
      Math.max(b.selfBytes, b.totalBytes) - Math.max(a.selfBytes, a.totalBytes) ||
      b.selfBytes - a.selfBytes ||
      b.totalBytes - a.totalBytes,
  );
  return allocators;
}

function buildAllocatorUserCaller(
  agg: AllocatorAggregate,
  aggregates: AggregateResult,
  totalSampledBytes: number,
): UserCallerAttribution | undefined {
  const top = [...agg.userCallerBytes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return undefined;
  const [callerId, attributedBytes] = top;
  const caller = aggregates.callerById.get(callerId);
  if (!caller) return undefined;
  const supportPct = agg.selfBytes > 0 ? (attributedBytes * 100) / agg.selfBytes : 0;
  const attribution: UserCallerAttribution = {
    function: caller.function,
    file: caller.file,
    line: caller.line,
    column: caller.column,
    profilePct: (attributedBytes * 100) / totalSampledBytes,
    supportPct,
    confidence: supportPct >= 80 ? 'high' : supportPct >= 50 ? 'medium' : 'low',
    basis: 'heap-sample-path',
  };
  if (caller.source) attribution.source = caller.source;
  return attribution;
}

function computeSeriesStats(
  samples: readonly MemoryUsageSample[],
  durationMs: number,
): MemoryAnalysisView['series'] {
  if (samples.length === 0) return {};
  return {
    rss: statsFor(samples, durationMs, (s) => s.rss),
    heapUsed: statsFor(samples, durationMs, (s) => s.heapUsed),
    external: statsFor(samples, durationMs, (s) => s.external),
    arrayBuffers: statsFor(samples, durationMs, (s) => s.arrayBuffers),
  };
}

function statsFor(
  samples: readonly MemoryUsageSample[],
  durationMs: number,
  pick: (s: MemoryUsageSample) => number,
): MemorySeriesStats {
  const values = samples.map(pick);
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / values.length;
  const p95Index = Math.min(values.length - 1, Math.floor(values.length * 0.95));
  const slope = linearRegressionSlope(samples, pick);
  return {
    startBytes: values[0] ?? 0,
    endBytes: values[values.length - 1] ?? 0,
    minBytes: sorted[0] ?? 0,
    maxBytes: sorted[sorted.length - 1] ?? 0,
    meanBytes: mean,
    p95Bytes: sorted[p95Index] ?? 0,
    slopeBytesPerSec: slope * 1000, // slope per ms → per sec
    // durationMs is unused here but kept in signature for future use.
    ...(durationMs > 0 ? {} : {}),
  };
}

/**
 * Least-squares slope of `pick(sample)` vs `sample.atMs` (bytes per ms).
 * Returns 0 when the sample window has no temporal spread.
 */
function linearRegressionSlope(
  samples: readonly MemoryUsageSample[],
  pick: (s: MemoryUsageSample) => number,
): number {
  const n = samples.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (const sample of samples) {
    const x = sample.atMs;
    const y = pick(sample);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}
