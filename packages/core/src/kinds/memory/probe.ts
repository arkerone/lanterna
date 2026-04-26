import {
  type RawSamplingHeapProfile,
  startHeapSampling,
  stopHeapSampling,
} from '../../capture/core/heap.js';
import type { CdpClient } from '../../inspector/client.js';
import type { MemoryUsageSample } from '../../report/types.js';
import { readMemoryUsageSeries } from '../../runtime-signals/readers/memory-usage.js';
import type { CaptureProbe } from '../core/types.js';

export interface MemoryKindData {
  samplingProfile: RawSamplingHeapProfile;
  samplingIntervalBytes: number;
  memoryUsage: {
    samples: MemoryUsageSample[];
    available: boolean;
    sampleIntervalMs: number;
  };
}

export interface MemoryProbeOptions {
  /** V8 heap sampling interval in bytes. Defaults to 512 KiB. */
  samplingIntervalBytes: number;
}

/**
 * Drives the V8 sampling heap profiler and reads back the
 * `process.memoryUsage()` time series collected by the preload hook.
 */
export function createMemoryProbe(options: MemoryProbeOptions): CaptureProbe<MemoryKindData> {
  return {
    async start(cdp: CdpClient) {
      await startHeapSampling(cdp, options.samplingIntervalBytes);
    },
    async stop(cdp: CdpClient): Promise<MemoryKindData> {
      const samplingProfile = await stopHeapSampling(cdp);
      const memoryUsage = cdp.closed
        ? { samples: [], available: false, sampleIntervalMs: 0 }
        : await readMemoryUsageSeries(cdp);
      return {
        samplingProfile,
        samplingIntervalBytes: options.samplingIntervalBytes,
        memoryUsage,
      };
    },
  };
}
