import { memoryProfileReportSchema } from '../../report/schema/memory-profile.js';
import { createMemoryUsageInstaller } from '../../runtime-signals/hooks/installers/memory-usage.js';
import type { CaptureProbe, ProfileKind } from '../core/types.js';
import { defineProfileKind } from '../core/types.js';
import { createMemoryAnalysisContributor } from './analysis.js';
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
}

/**
 * The memory profile kind. Drives `HeapProfiler.startSampling` / `stopSampling`
 * over CDP, samples `process.memoryUsage()` from a preload hook, and contributes
 * the `profiles.memory.*` section of the Lanterna report.
 */
export function createMemoryProfileKind(
  options: MemoryKindOptions = {},
): ProfileKind<MemoryKindData> {
  const samplingIntervalBytes =
    options.samplingIntervalBytes ?? DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES;
  const memoryUsageIntervalMs = options.memoryUsageIntervalMs ?? DEFAULT_MEMORY_USAGE_INTERVAL_MS;
  return defineProfileKind<MemoryKindData>({
    id: 'memory',
    label: 'Memory',
    reportSectionKey: 'memory',
    reportSchema: memoryProfileReportSchema,
    hookInstaller: createMemoryUsageInstaller({ sampleIntervalMs: memoryUsageIntervalMs }),
    createProbe: (): CaptureProbe<MemoryKindData> => createMemoryProbe({ samplingIntervalBytes }),
    createAnalysisContributor: () => createMemoryAnalysisContributor(),
    contributeMeta: (data) => ({
      samplingIntervalBytes: data.samplingIntervalBytes,
      memoryUsageIntervalMs,
      memoryUsageSampleCount: data.memoryUsage.samples.length,
    }),
    contributeIntegrity: (data) => ({
      memoryUsageAvailable: data.memoryUsage.available,
      memoryUsageSampleCount: data.memoryUsage.samples.length,
    }),
  });
}

export type { MemoryAnalysisView } from './analysis.js';
export { createMemoryAnalysisContributor } from './analysis.js';
export type { MemoryKindData, MemoryProbeOptions } from './probe.js';
export { createMemoryProbe } from './probe.js';
