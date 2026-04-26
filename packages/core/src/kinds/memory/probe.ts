import {
  type RawSamplingHeapProfile,
  startHeapSampling,
  stopHeapSampling,
} from '../../capture/core/heap.js';
import type { CdpClient } from '../../inspector/client.js';
import type { MemoryUsageSample } from '../../report/types.js';
import { readMemoryUsageSeries } from '../../runtime-signals/readers/memory-usage.js';
import type { CaptureProbe } from '../core/types.js';
import {
  type CapturedHeapSnapshots,
  type HeapSnapshotAnalysisReport,
  type NormalizedHeapSnapshotAnalysisOptions,
  resolveHeapSnapshotPath,
  takeHeapSnapshotToFile,
} from './heap-snapshot-analysis.js';

export interface MemoryKindData {
  samplingProfile: RawSamplingHeapProfile;
  samplingIntervalBytes: number;
  memoryUsage: {
    samples: MemoryUsageSample[];
    available: boolean;
    sampleIntervalMs: number;
  };
  heapSnapshotAnalysis?: CapturedHeapSnapshots | HeapSnapshotAnalysisReport;
}

export interface MemoryProbeOptions {
  /** V8 heap sampling interval in bytes. Defaults to 512 KiB. */
  samplingIntervalBytes: number;
  /** `process.memoryUsage()` cadence in ms. */
  memoryUsageIntervalMs: number;
  heapSnapshotAnalysis?: NormalizedHeapSnapshotAnalysisOptions;
}

/**
 * Drives the V8 sampling heap profiler and reads back the
 * `process.memoryUsage()` time series collected by the preload hook.
 */
export function createMemoryProbe(options: MemoryProbeOptions): CaptureProbe<MemoryKindData> {
  let capturedHeapSnapshots: CapturedHeapSnapshots | undefined;
  return {
    ...(options.heapSnapshotAnalysis?.enabled ? { stopTimeoutMs: false as const } : {}),
    ...(options.heapSnapshotAnalysis?.enabled
      ? {
          progressMessages: {
            start: 'Starting Memory heap snapshot. This can take a while; press Ctrl+C to abort.',
            stop: 'Taking final Memory heap snapshot. This can take a while; press Ctrl+C to abort and keep the standard report.',
          },
        }
      : {}),
    async start(cdp: CdpClient, startOptions: { abortSignal?: AbortSignal } = {}) {
      if (options.heapSnapshotAnalysis?.enabled) {
        const outputDir = options.heapSnapshotAnalysis.outputDir ?? '.lanterna-heapsnapshots';
        const startPath = resolveHeapSnapshotPath(outputDir, 'start');
        const endPath = resolveHeapSnapshotPath(outputDir, 'end');
        capturedHeapSnapshots = {
          available: true,
          mode: 'start-end',
          start: { path: startPath },
          end: { path: endPath },
          warnings: [],
        };
        try {
          await takeHeapSnapshotToFile(cdp, startPath, {
            abortSignal: startOptions.abortSignal,
          });
        } catch (error) {
          capturedHeapSnapshots.available = false;
          capturedHeapSnapshots.warnings.push(
            `failed to capture start heap snapshot: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      await startHeapSampling(cdp, options.samplingIntervalBytes);
    },
    async stop(
      cdp: CdpClient,
      stopOptions: { abortSignal?: AbortSignal; stopReason?: 'exit' | 'timeout' | 'signal' } = {},
    ): Promise<MemoryKindData> {
      const samplingProfile = await stopHeapSampling(cdp);
      if (options.heapSnapshotAnalysis?.enabled && capturedHeapSnapshots) {
        if (stopOptions.stopReason === 'signal') {
          capturedHeapSnapshots.available = false;
          capturedHeapSnapshots.warnings.push(
            'skipped end heap snapshot because capture was stopped manually',
          );
        } else {
          try {
            await takeHeapSnapshotToFile(cdp, capturedHeapSnapshots.end.path, {
              abortSignal: stopOptions.abortSignal,
            });
          } catch (error) {
            capturedHeapSnapshots.available = false;
            capturedHeapSnapshots.warnings.push(
              `failed to capture end heap snapshot: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
      const memoryUsage = cdp.closed
        ? { samples: [], available: false, sampleIntervalMs: options.memoryUsageIntervalMs }
        : await readMemoryUsageSeries(cdp);
      return {
        samplingProfile,
        samplingIntervalBytes: options.samplingIntervalBytes,
        memoryUsage: {
          ...memoryUsage,
          sampleIntervalMs: memoryUsage.sampleIntervalMs || options.memoryUsageIntervalMs,
        },
        ...(capturedHeapSnapshots ? { heapSnapshotAnalysis: capturedHeapSnapshots } : {}),
      };
    },
  };
}
