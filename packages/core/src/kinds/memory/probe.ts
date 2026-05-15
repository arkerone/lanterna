import {
  type RawSamplingHeapProfile,
  startHeapSampling,
  stopHeapSampling,
} from '../../capture/core/heap.js';
import type { MemoryUsageSample } from '../../report/types.js';
import {
  disableMemoryUsageSeries,
  readMemoryUsageSeries,
} from '../../runtime-signals/readers/memory-usage.js';
import type { CaptureProbe, ProbeLifecycleContext, ProbeStopReason } from '../core/types.js';
import {
  type CapturedHeapSnapshots,
  DEFAULT_HEAP_SNAPSHOT_CAPTURE_TIMEOUT_MS,
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
  heapSamplingAvailable?: boolean;
  warnings?: string[];
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
  const warnings: string[] = [];
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
    async start(ctx: ProbeLifecycleContext & { abortSignal?: AbortSignal }) {
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
          await takeHeapSnapshotToFile(ctx.cdp, startPath, {
            abortSignal: ctx.abortSignal,
            timeoutMs: DEFAULT_HEAP_SNAPSHOT_CAPTURE_TIMEOUT_MS,
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
      await startHeapSampling(ctx.cdp, options.samplingIntervalBytes);
    },
    async stop(
      ctx: ProbeLifecycleContext & { abortSignal?: AbortSignal; stopReason?: ProbeStopReason },
    ): Promise<MemoryKindData> {
      let samplingProfile: RawSamplingHeapProfile;
      let heapSamplingAvailable = true;
      try {
        if (ctx.cdp.closed) throw new Error('CDP connection closed before heap sampling stopped');
        samplingProfile = await stopHeapSampling(ctx.cdp);
      } catch (error) {
        heapSamplingAvailable = false;
        warnings.push(
          `failed to stop heap sampling: ${error instanceof Error ? error.message : String(error)}`,
        );
        samplingProfile = emptySamplingProfile();
      }
      if (options.heapSnapshotAnalysis?.enabled && capturedHeapSnapshots) {
        if (ctx.stopReason === 'signal') {
          capturedHeapSnapshots.available = false;
          capturedHeapSnapshots.warnings.push(
            'skipped end heap snapshot because capture was stopped manually',
          );
        } else {
          try {
            await takeHeapSnapshotToFile(ctx.cdp, capturedHeapSnapshots.end.path, {
              abortSignal: ctx.abortSignal,
              timeoutMs: DEFAULT_HEAP_SNAPSHOT_CAPTURE_TIMEOUT_MS,
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
      const memoryUsage = await readMemoryUsage(ctx, options.memoryUsageIntervalMs);
      return {
        samplingProfile,
        samplingIntervalBytes: options.samplingIntervalBytes,
        memoryUsage: {
          ...memoryUsage,
          sampleIntervalMs: memoryUsage.sampleIntervalMs || options.memoryUsageIntervalMs,
        },
        heapSamplingAvailable,
        ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
        ...(capturedHeapSnapshots ? { heapSnapshotAnalysis: capturedHeapSnapshots } : {}),
      };
    },
    async dispose(ctx: ProbeLifecycleContext) {
      if (ctx.cdp.closed) return;
      await disableMemoryUsageSeries(ctx.cdp);
      await ctx.cdp.send('HeapProfiler.disable');
    },
  };
}

async function readMemoryUsage(
  ctx: ProbeLifecycleContext & {
    liveSourceSignals?: () => import('../../capture/core/types.js').LiveSourceSignals;
  },
  fallbackIntervalMs: number,
) {
  const live = ctx.liveSourceSignals?.();
  if (!ctx.cdp.closed) {
    const memoryUsage = await readMemoryUsageSeries(ctx.cdp);
    if (memoryUsage.available || memoryUsage.samples.length > 0) return memoryUsage;
  }
  if (live?.memoryUsageSamples && live.memoryUsageSamples.length > 0) {
    return {
      samples: live.memoryUsageSamples,
      available: true,
      sampleIntervalMs: live.memoryUsageSampleIntervalMs ?? fallbackIntervalMs,
    };
  }
  return { samples: [], available: false, sampleIntervalMs: fallbackIntervalMs };
}

function emptySamplingProfile(): RawSamplingHeapProfile {
  return {
    head: {
      callFrame: {
        functionName: '(root)',
        scriptId: '0',
        url: '',
        lineNumber: 0,
        columnNumber: 0,
      },
      selfSize: 0,
      id: 1,
      children: [],
    },
    samples: [],
  };
}
