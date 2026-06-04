import type {
  AsyncHotFile,
  AsyncOperationKindReport,
  AsyncSummary,
} from '../../../report/types.js';
import { buildByKindLatency } from '../latency.js';
import type { AsyncKindData } from '../types.js';

export function buildSummary(
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
          meanInflight: mean(data.concurrency.map((sample) => sample.inflight)),
          maxInflight: data.concurrency.reduce((max, sample) => Math.max(max, sample.inflight), 0),
          meanActive: mean(data.concurrency.map((sample) => sample.active)),
          maxActive: data.concurrency.reduce((max, sample) => Math.max(max, sample.active), 0),
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

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[index] ?? 0;
}
