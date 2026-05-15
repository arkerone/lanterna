import type {
  BaseFinding,
  Finding,
  KindScopedDetector,
  KindScopedDetectorShared,
  MemoryHotAllocator,
  MemorySummary,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import {
  type CorrelatedAllocatorEvidence,
  correlatedAllocatorFromCpuHotspot,
  correlatedAllocatorFromMemory,
} from './memory-evidence.js';

const BYTES_PER_MB = 1024 * 1024;

/**
 * Fires when off-heap memory (`external`) is large relative
 * to the V8 heap. Off-heap allocations live outside V8's GC reach (Buffer,
 * TypedArray-backed storage, native modules) and often indicate
 * Buffer-leak-shaped problems that don't show up in heap snapshots.
 */
export const externalBufferPressureDetector: KindScopedDetector<'memory'> = {
  id: 'external-buffer-pressure',
  kindIds: ['memory'],
  detect({ memory }, shared): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.externalBufferPressure;
    const series = memory.view.series;
    const heapUsed = series.heapUsed;
    const external = series.external;
    const arrayBuffers = series.arrayBuffers;
    if (!heapUsed || !external || !arrayBuffers) return [];

    const externalMeanMB = external.meanBytes / BYTES_PER_MB;
    if (externalMeanMB < thresholds.minExternalMeanMB) return [];

    const ratio = external.meanBytes / Math.max(heapUsed.meanBytes, 1);
    if (ratio < thresholds.warnRatio) return [];

    const severity: BaseFinding['severity'] =
      ratio >= thresholds.criticalRatio ? 'critical' : 'warning';
    const peakExternalMB = external.maxBytes / BYTES_PER_MB;
    const heapMeanMB = heapUsed.meanBytes / BYTES_PER_MB;
    const allocator = correlatedExternalAllocator(memory, shared);

    const finding: BaseFinding<string, Record<string, unknown>> = {
      id: 'external-buffer-pressure',
      profileKind: 'memory',
      severity,
      category: 'external-buffer-pressure',
      title: `Off-heap memory is ${ratio.toFixed(1)}× the V8 heap`,
      confidence: 'medium',
      proofLevel: 'heuristic',
      evidence: {
        file: 'process.memoryUsage',
        line: 0,
        function: 'external',
        selfPct: 0,
        extra: {
          ratio,
          externalMeanMB,
          peakExternalMB,
          heapMeanMB,
          arrayBuffersMeanMB: arrayBuffers.meanBytes / BYTES_PER_MB,
          externalMeanBytes: external.meanBytes,
          arrayBuffersMeanBytes: arrayBuffers.meanBytes,
          heapUsedMeanBytes: heapUsed.meanBytes,
          ...(allocator ? { correlatedAllocator: allocator } : {}),
        },
      },
      measurements: {
        observed: {
          ratio,
          externalMeanMB,
          peakExternalMB,
          heapMeanMB,
        },
        thresholds: {
          warnRatio: thresholds.warnRatio,
          criticalRatio: thresholds.criticalRatio,
          minExternalMeanMB: thresholds.minExternalMeanMB,
        },
      },
      why: `Off-heap memory (Buffer / TypedArray / native modules) averages ${externalMeanMB.toFixed(0)} MB while heapUsed averages ${heapMeanMB.toFixed(0)} MB. Off-heap memory isn't bounded by --max-old-space-size and isn't visible in V8 heap snapshots — it grows silently until the kernel kills the process.`,
      suggestion:
        'Audit Buffer allocations: prefer `Buffer.allocUnsafeSlow(n)` only when intentional, reuse pooled Buffers, and avoid retaining response bodies after the request finishes. Check for leaks in native modules (sharp, libpq, zlib streams). Consider `process.memoryUsage().arrayBuffers` to differentiate ArrayBuffer-backed allocations from generic native ones.',
      references: [
        'https://nodejs.org/api/buffer.html#bufferpoolsize',
        'https://nodejs.org/api/process.html#processmemoryusage',
      ],
    };
    return [finding];
  },
};

function correlatedExternalAllocator(
  memory: { report: { summary: MemorySummary; hotAllocators: readonly MemoryHotAllocator[] } },
  shared: KindScopedDetectorShared,
): CorrelatedAllocatorEvidence | undefined {
  return (
    correlatedAllocatorFromCpuHotspot(topCpuUserHotspot(shared)) ??
    correlatedAllocatorFromMemory(memory.report.summary, memory.report.hotAllocators)
  );
}

function topCpuUserHotspot(shared: KindScopedDetectorShared) {
  return shared.profiles.cpu?.hotspots.find(
    (hotspot) =>
      hotspot.category === 'user' &&
      hotspot.totalPct > 1 &&
      hotspot.function !== '(anonymous)' &&
      hotspot.function.trim() !== '',
  );
}
