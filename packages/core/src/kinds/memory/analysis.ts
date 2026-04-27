import { classifyFrame } from '../../analysis/model/classify.js';
import type {
  RawSamplingHeapProfile,
  RawSamplingHeapProfileNode,
} from '../../capture/core/heap.js';
import type { CaptureBundle } from '../../capture/core/types.js';
import type {
  FrameCategory,
  MemoryHotAllocator,
  MemoryProfileReport,
  MemorySeriesStats,
  MemorySummary,
  MemoryUsageSample,
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
      const aggregates = aggregateAllocators(data.samplingProfile, bundle.target.cwd);
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

      const report: MemoryProfileReport = {
        summary,
        hotAllocators: hotAllocators.slice(0, MAX_PUBLIC_HOT_ALLOCATORS),
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
}

interface AggregateResult {
  byId: Map<string, AllocatorAggregate>;
  totalSelfBytes: number;
}

function aggregateAllocators(profile: RawSamplingHeapProfile, cwd: string): AggregateResult {
  const byId = new Map<string, AllocatorAggregate>();
  let totalSelfBytes = 0;

  // Walk: post-order accumulation of subtree size into `totalBytes`, summing
  // self into the per-frame aggregate keyed by (file, function, line, column).
  const walk = (node: RawSamplingHeapProfileNode): number => {
    let subtreeSize = node.selfSize;
    for (const child of node.children) subtreeSize += walk(child);

    const cf = node.callFrame;
    const classified = classifyFrame(cf.functionName || '(anonymous)', cf.url || '', cwd);
    // V8 emits 0-indexed line/column; the rest of the report uses 1-indexed
    // numbers (see `enrichCpuTree`), so normalize here for cross-kind keying.
    const line = cf.lineNumber + 1;
    const column = cf.columnNumber + 1;
    const id = `${classified.file}:${line}:${column}:${cf.functionName || '(anonymous)'}`;

    const existing = byId.get(id);
    if (existing) {
      existing.selfBytes += node.selfSize;
      existing.totalBytes += subtreeSize;
    } else {
      byId.set(id, {
        id,
        function: cf.functionName || '(anonymous)',
        file: classified.file,
        line,
        column,
        category: classified.category,
        ...(classified.package ? { package: classified.package } : {}),
        selfBytes: node.selfSize,
        totalBytes: subtreeSize,
      });
    }
    totalSelfBytes += node.selfSize;
    return subtreeSize;
  };

  walk(profile.head);
  return { byId, totalSelfBytes };
}

function buildHotAllocators(
  aggregates: AggregateResult,
  totalSampledBytes: number,
): MemoryHotAllocator[] {
  const denom = totalSampledBytes > 0 ? totalSampledBytes : 1;
  const includeLanternaSelfFrames = process.env.LANTERNA_DEBUG_SELF === '1';
  const allocators: MemoryHotAllocator[] = [];
  for (const agg of aggregates.byId.values()) {
    if (agg.selfBytes === 0 && agg.totalBytes === 0) continue;
    // Skip the synthetic V8 root frame — it carries no actionable signal,
    // only the rolled-up subtree total.
    if (agg.function === '(root)') continue;
    // Lanterna's own preload + runtime-signals hooks allocate inside the
    // target process; without this filter they pollute hot allocators.
    if (agg.category === 'lanterna' && !includeLanternaSelfFrames) continue;
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
