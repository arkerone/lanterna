import { memoryProfileReportSchema } from '../../report/schema/memory-profile.js';
import { createMemoryUsageInstaller } from '../../runtime-signals/hooks/installers/memory-usage.js';
import type { CaptureProbe, ProfileKind } from '../core/types.js';
import { defineProfileKind } from '../core/types.js';
import { createMemoryAnalysisContributor } from './analysis.js';
import {
  type HeapSnapshotAnalysisOptions,
  normalizeHeapSnapshotAnalysisOptions,
} from './heap-snapshot-analysis.js';
import { createMemoryProbe, type MemoryKindData } from './probe.js';

declare module '../core/types.js' {
  interface CaptureKindDataMap {
    memory: MemoryKindData;
  }
}

/** Default V8 sampling heap profiler interval (bytes between sampled allocations). */
export const DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES = 512 * 1024;
/** Default cadence for `process.memoryUsage()` snapshots in the preload hook. */
export const DEFAULT_MEMORY_USAGE_INTERVAL_MS = 250;

export interface MemoryKindOptions {
  /** V8 heap sampling interval in bytes. Defaults to 512 KiB. */
  samplingIntervalBytes?: number;
  /** `process.memoryUsage()` cadence in ms. Defaults to 250 ms. */
  memoryUsageIntervalMs?: number;
  /** Include the raw `process.memoryUsage()` sample series in the public JSON report. */
  includeMemoryUsageSamples?: boolean;
  /** Heavy opt-in V8 heap snapshot start/end analysis. Disabled by default. */
  heapSnapshotAnalysis?: HeapSnapshotAnalysisOptions;
}

/**
 * The memory profile kind. Drives `HeapProfiler.startSampling` / `stopSampling`
 * over CDP, samples `process.memoryUsage()` from a preload hook, and contributes
 * the `profiles.memory.*` section of the Lanterna report.
 */
export function createMemoryProfileKind(
  options: MemoryKindOptions = {},
): ProfileKind<MemoryKindData> {
  const samplingIntervalBytes = validateSamplingIntervalBytes(
    options.samplingIntervalBytes ?? DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  );
  const memoryUsageIntervalMs = validateMemoryUsageIntervalMs(
    options.memoryUsageIntervalMs ?? DEFAULT_MEMORY_USAGE_INTERVAL_MS,
  );
  const heapSnapshotAnalysis = normalizeHeapSnapshotAnalysisOptions(options.heapSnapshotAnalysis);
  return defineProfileKind<MemoryKindData>({
    id: 'memory',
    label: 'Memory',
    reportSectionKey: 'memory',
    reportSchema: memoryProfileReportSchema,
    ...(heapSnapshotAnalysis.enabled
      ? {
          manualStopMessage:
            'Stop requested. Aborting Memory heap snapshot work and writing the standard report...',
        }
      : {}),
    hookInstaller: createMemoryUsageInstaller({ sampleIntervalMs: memoryUsageIntervalMs }),
    createProbe: (): CaptureProbe<MemoryKindData> =>
      createMemoryProbe({ samplingIntervalBytes, memoryUsageIntervalMs, heapSnapshotAnalysis }),
    createAnalysisContributor: () =>
      createMemoryAnalysisContributor({
        includeMemoryUsageSamples: options.includeMemoryUsageSamples ?? false,
        heapSnapshotAnalysis,
      }),
    contributeMeta: (data) => ({
      samplingIntervalBytes: data.samplingIntervalBytes,
      memoryUsageIntervalMs,
      memoryUsageSampleCount: data.memoryUsage.samples.length,
      heapSnapshotAnalysisEnabled: heapSnapshotAnalysis.enabled,
      ...(data.heapSnapshotAnalysis
        ? { heapSnapshotAnalysisAvailable: data.heapSnapshotAnalysis.available }
        : {}),
    }),
    contributeIntegrity: (data) => ({
      memoryUsageAvailable: data.memoryUsage.available,
      memoryUsageSampleCount: data.memoryUsage.samples.length,
      ...(data.heapSnapshotAnalysis
        ? { heapSnapshotAnalysisAvailable: data.heapSnapshotAnalysis.available }
        : {}),
    }),
  });
}

function validateSamplingIntervalBytes(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1024) {
    throw new Error(
      `invalid memory sampling interval: ${value} (expected an integer >= 1024 bytes)`,
    );
  }
  return value;
}

function validateMemoryUsageIntervalMs(value: number): number {
  if (!Number.isFinite(value) || value < 10) {
    throw new Error(`invalid memory usage interval: ${value} (expected >= 10ms)`);
  }
  return value;
}

export type { MemoryAnalysisView } from './analysis.js';
export { createMemoryAnalysisContributor } from './analysis.js';
export type {
  HeapSnapshotAnalysisOptions,
  HeapSnapshotAnalysisReport,
  HeapSnapshotGrowthEntry,
  HeapSnapshotRetainerPath,
  HeapSnapshotSuspectedPattern,
} from './heap-snapshot-analysis.js';
export type { MemoryKindData, MemoryProbeOptions } from './probe.js';
export { createMemoryProbe } from './probe.js';
