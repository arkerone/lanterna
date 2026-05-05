import { MIN_SAMPLE_INTERVAL_MICROS } from '@lanterna-profiler/core';

export type OutputFormat = 'json' | 'text' | 'markdown' | 'agent';

export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
export const MIN_HEAP_SAMPLING_INTERVAL_BYTES = 1024;
export const MIN_MEMORY_USAGE_INTERVAL_MS = 10;

export const PROVIDED_FLAG_ALIASES: Readonly<Record<string, string>> = {
  'heap-sample-interval': 'heapSamplingIntervalBytes',
  'memory-usage-interval': 'memoryUsageIntervalMs',
  'include-memory-samples': 'includeMemoryUsageSamples',
  'heap-snapshot-analysis': 'heapSnapshotAnalysis',
  'heap-snapshot-dir': 'heapSnapshotAnalysis',
  'sample-interval': 'sampleIntervalMicros',
  'wait-for-url': 'waitForUrl',
  'wait-timeout': 'waitTimeoutMs',
  'capture-delay': 'captureDelayMs',
  detectors: 'detectors',
  kind: 'kind',
  duration: 'durationMs',
  output: 'output',
  format: 'format',
  pretty: 'pretty',
  'no-source-maps': 'sourceMaps',
  workload: 'workload',
  'async-max-events': 'asyncMaxRecords',
  'async-stack-depth': 'asyncStackDepth',
  'async-include-microtasks': 'asyncIncludeMicrotasks',
  'async-concurrency-interval': 'asyncConcurrencyIntervalMs',
  'async-instrumentation': 'asyncInstrumentation',
};

export function parseDurationMs(value: string | number, fieldName = 'duration'): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= 0) return value;
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(value);
  if (!match) throw new Error(`Invalid ${fieldName}: ${value}`);

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  return amount;
}

export function parseHeapSamplingIntervalBytes(
  value: string | number,
  fieldName = 'heapSampleInterval',
): number {
  const raw = String(value).trim();
  const match = /^(\d+(?:\.\d+)?)\s*(b|kib|kb|k|mib|mb|m)?$/i.exec(raw);
  if (!match) throw new Error(`Invalid ${fieldName}: ${value}`);

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const bytes = Math.round(amount * heapSamplingUnitMultiplier(unit));

  if (!Number.isFinite(bytes) || bytes < MIN_HEAP_SAMPLING_INTERVAL_BYTES) {
    throw new Error(
      `Invalid ${fieldName} (min ${MIN_HEAP_SAMPLING_INTERVAL_BYTES} bytes / 1KiB): ${value}`,
    );
  }
  return bytes;
}

export function parseMemoryUsageIntervalMs(
  value: string | number,
  fieldName = 'memoryUsageInterval',
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_MEMORY_USAGE_INTERVAL_MS) {
    throw new Error(`Invalid ${fieldName} (min ${MIN_MEMORY_USAGE_INTERVAL_MS}ms): ${value}`);
  }
  return parsed;
}

export function parseSampleIntervalMicros(
  value: string | number,
  fieldName = 'sampleInterval',
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_SAMPLE_INTERVAL_MICROS) {
    throw new Error(`Invalid ${fieldName} (min ${MIN_SAMPLE_INTERVAL_MICROS}): ${value}`);
  }
  return parsed;
}

export function parseOutputFormat(value: string): OutputFormat {
  if (value === 'json' || value === 'text' || value === 'markdown' || value === 'agent') {
    return value;
  }
  throw new Error(`Invalid format: ${value} (expected json, text, markdown, or agent)`);
}

export function normalizeKinds(
  raw: readonly string[] | undefined,
  fallback: string[] = [],
): string[] {
  if (!raw || raw.length === 0) return fallback;
  return dedupe(expandKindValues(raw));
}

export function heapSnapshotOptionName(options: {
  heapSnapshotAnalysis?: boolean;
  heapSnapshotDir?: string;
}): '--heap-snapshot-analysis' | '--heap-snapshot-dir' {
  if (options.heapSnapshotAnalysis) return '--heap-snapshot-analysis';
  return '--heap-snapshot-dir';
}

function heapSamplingUnitMultiplier(unit: string): number {
  if (unit === 'mib' || unit === 'mb' || unit === 'm') return 1024 * 1024;
  if (unit === 'kib' || unit === 'kb' || unit === 'k') return 1024;
  return 1;
}

function expandKindValues(values: readonly string[]): string[] {
  return values.flatMap((value) =>
    value
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean),
  );
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
