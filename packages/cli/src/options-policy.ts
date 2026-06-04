import {
  DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  DEFAULT_ASYNC_MAX_RECORDS,
  DEFAULT_ASYNC_STACK_DEPTH,
  DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  DEFAULT_MEMORY_USAGE_INTERVAL_MS,
  DEFAULT_SAMPLE_INTERVAL_MICROS,
} from '@lanterna-profiler/core';
import {
  heapSnapshotOptionName,
  normalizeKinds,
  type OutputFormat,
} from './options-normalization.js';

export interface ParsedProfileOptionInput {
  duration?: number;
  output?: string;
  format?: OutputFormat;
  pretty?: boolean;
  sampleInterval?: number;
  heapSampleInterval?: number;
  memoryUsageInterval?: number;
  includeMemorySamples?: boolean;
  heapSnapshotAnalysis?: boolean;
  heapSnapshotDir?: string;
  asyncMaxEvents?: number;
  asyncStackDepth?: number;
  asyncIncludeMicrotasks?: boolean;
  asyncConcurrencyInterval?: number;
  asyncInstrumentation?: 'off' | 'safe' | 'full';
  detectors?: string[];
  kind?: string[];
  sourceMaps?: boolean;
}

export interface NormalizedProfileOptions {
  durationMs?: number;
  output?: string;
  format: OutputFormat;
  pretty: boolean;
  sampleIntervalMicros: number;
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
  asyncMaxRecords: number;
  asyncStackDepth: number;
  asyncIncludeMicrotasks: boolean;
  asyncConcurrencyIntervalMs: number;
  asyncInstrumentation: 'off' | 'safe' | 'full';
  detectors: string[];
  kinds: string[];
  sourceMaps: boolean;
}

export function normalizeProfileOptions(
  parsed: ParsedProfileOptionInput,
  fallbackKinds: string[] = ['cpu'],
): NormalizedProfileOptions {
  const kinds = normalizeKinds(parsed.kind, fallbackKinds);
  assertKindScopedOptionsAllowed(parsed, kinds);
  const options: NormalizedProfileOptions = {
    format: parsed.format ?? 'json',
    pretty: Boolean(parsed.pretty),
    sourceMaps: parsed.sourceMaps !== false,
    sampleIntervalMicros: parsed.sampleInterval ?? DEFAULT_SAMPLE_INTERVAL_MICROS,
    heapSamplingIntervalBytes: parsed.heapSampleInterval ?? DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
    memoryUsageIntervalMs: parsed.memoryUsageInterval ?? DEFAULT_MEMORY_USAGE_INTERVAL_MS,
    includeMemoryUsageSamples: Boolean(parsed.includeMemorySamples),
    heapSnapshotAnalysis: {
      enabled: Boolean(parsed.heapSnapshotAnalysis),
    },
    asyncMaxRecords: parsed.asyncMaxEvents ?? DEFAULT_ASYNC_MAX_RECORDS,
    asyncStackDepth: parsed.asyncStackDepth ?? DEFAULT_ASYNC_STACK_DEPTH,
    asyncIncludeMicrotasks: Boolean(parsed.asyncIncludeMicrotasks),
    asyncConcurrencyIntervalMs:
      parsed.asyncConcurrencyInterval ?? DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
    asyncInstrumentation: parsed.asyncInstrumentation ?? 'safe',
    detectors: parsed.detectors ?? [],
    kinds,
  };
  if (parsed.duration !== undefined) options.durationMs = parsed.duration;
  if (parsed.output) options.output = parsed.output;
  if (parsed.heapSnapshotDir) options.heapSnapshotAnalysis.outputDir = parsed.heapSnapshotDir;
  return options;
}

function assertKindScopedOptionsAllowed(
  parsed: ParsedProfileOptionInput,
  kinds: readonly string[],
): void {
  if (hasHeapSnapshotOptions(parsed) && !kinds.includes('memory')) {
    const option = heapSnapshotOptionName(parsed);
    throw new Error(`${option} requires --kind memory`);
  }
  if (hasAsyncOptions(parsed) && !kinds.includes('async')) {
    throw new Error('--async-* options require --kind async');
  }
}

function hasHeapSnapshotOptions(parsed: ParsedProfileOptionInput): boolean {
  return Boolean(parsed.heapSnapshotAnalysis || parsed.heapSnapshotDir);
}

function hasAsyncOptions(parsed: ParsedProfileOptionInput): boolean {
  return (
    parsed.asyncMaxEvents !== undefined ||
    parsed.asyncStackDepth !== undefined ||
    parsed.asyncIncludeMicrotasks !== undefined ||
    parsed.asyncConcurrencyInterval !== undefined ||
    parsed.asyncInstrumentation !== undefined
  );
}
