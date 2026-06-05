import {
  DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  DEFAULT_ASYNC_MAX_RECORDS,
  DEFAULT_ASYNC_STACK_DEPTH,
  DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  DEFAULT_MEMORY_USAGE_INTERVAL_MS,
  DEFAULT_SAMPLE_INTERVAL_MICROS,
} from '@lanterna-profiler/core';
import { normalizeKinds, type OutputFormat } from './options-normalization.js';

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
  sourceMapRemote?: boolean;
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
  sourceMapRemote: boolean;
}

export function normalizeProfileOptions(
  parsed: ParsedProfileOptionInput,
  fallbackKinds: string[] = ['cpu'],
): NormalizedProfileOptions {
  const kinds = normalizeKinds(parsed.kind, fallbackKinds);
  const options: NormalizedProfileOptions = {
    format: parsed.format ?? 'json',
    pretty: Boolean(parsed.pretty),
    sourceMaps: parsed.sourceMaps !== false,
    sourceMapRemote: Boolean(parsed.sourceMapRemote),
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

export interface KindScopedValidationConfig {
  kinds?: string[];
  heapSnapshotAnalysis?: {
    enabled: boolean;
    outputDir?: string;
  };
  asyncMaxRecords?: number;
  asyncStackDepth?: number;
  asyncIncludeMicrotasks?: boolean;
  asyncConcurrencyIntervalMs?: number;
  asyncInstrumentation?: 'off' | 'safe' | 'full';
}

export interface KindScopedValidationContext {
  config: KindScopedValidationConfig | undefined;
  providedFlags: ReadonlySet<string>;
}

export function validateKindScopedOptions(
  options: Pick<
    NormalizedProfileOptions,
    | 'kinds'
    | 'heapSnapshotAnalysis'
    | 'asyncMaxRecords'
    | 'asyncStackDepth'
    | 'asyncIncludeMicrotasks'
    | 'asyncConcurrencyIntervalMs'
    | 'asyncInstrumentation'
  >,
  context: KindScopedValidationContext,
): void {
  if (
    hasActiveHeapSnapshotFlag(options, context.providedFlags) &&
    !options.kinds.includes('memory')
  ) {
    throw new Error(`${heapSnapshotFlagName(options.heapSnapshotAnalysis)} requires --kind memory`);
  }
  if (hasActiveHeapSnapshotConfig(context.config) && !options.kinds.includes('memory')) {
    throw new Error('heap snapshot analysis in Lanterna config requires kind "memory"');
  }
  if (hasActiveAsyncFlag(context.providedFlags) && !options.kinds.includes('async')) {
    throw new Error('--async-* options require --kind async');
  }
  if (hasActiveAsyncConfig(context.config) && !options.kinds.includes('async')) {
    throw new Error('async options in Lanterna config require kind "async"');
  }
}

function hasActiveHeapSnapshotFlag(
  options: Pick<NormalizedProfileOptions, 'heapSnapshotAnalysis'>,
  providedFlags: ReadonlySet<string>,
): boolean {
  if (!providedFlags.has('heapSnapshotAnalysis')) return false;
  return hasActiveHeapSnapshot(options.heapSnapshotAnalysis);
}

function hasActiveHeapSnapshotConfig(config: KindScopedValidationConfig | undefined): boolean {
  return hasActiveHeapSnapshot(config?.heapSnapshotAnalysis);
}

function hasActiveHeapSnapshot(
  heapSnapshot:
    | Pick<NormalizedProfileOptions['heapSnapshotAnalysis'], 'enabled' | 'outputDir'>
    | undefined,
): boolean {
  return Boolean(heapSnapshot?.enabled || heapSnapshot?.outputDir);
}

function heapSnapshotFlagName(
  heapSnapshot: Pick<NormalizedProfileOptions['heapSnapshotAnalysis'], 'enabled' | 'outputDir'>,
): '--heap-snapshot-analysis' | '--heap-snapshot-dir' {
  if (heapSnapshot.enabled) return '--heap-snapshot-analysis';
  return '--heap-snapshot-dir';
}

function hasActiveAsyncFlag(providedFlags: ReadonlySet<string>): boolean {
  return (
    providedFlags.has('asyncMaxRecords') ||
    providedFlags.has('asyncStackDepth') ||
    providedFlags.has('asyncIncludeMicrotasks') ||
    providedFlags.has('asyncConcurrencyIntervalMs') ||
    providedFlags.has('asyncInstrumentation')
  );
}

function hasActiveAsyncConfig(config: KindScopedValidationConfig | undefined): boolean {
  return (
    config?.asyncMaxRecords !== undefined ||
    config?.asyncStackDepth !== undefined ||
    config?.asyncIncludeMicrotasks !== undefined ||
    config?.asyncConcurrencyIntervalMs !== undefined ||
    config?.asyncInstrumentation !== undefined
  );
}
