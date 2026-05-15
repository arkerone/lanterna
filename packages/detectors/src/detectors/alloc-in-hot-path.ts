import type {
  BaseFinding,
  Finding,
  Hotspot,
  KindScopedDetector,
  MemoryHotAllocator,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';

/**
 * Cross-kind detector: a frame that appears in the top CPU hotspots AND in the
 * top memory allocators. Fixing such a frame yields double dividends — fewer
 * cycles spent and less GC pressure.
 *
 * Requires both the `cpu` and `memory` kinds to be present in the capture.
 */
export const allocInHotPathDetector: KindScopedDetector<'cpu' | 'memory'> = {
  id: 'alloc-in-hot-path',
  kindIds: ['cpu', 'memory'],
  detect({ cpu, memory }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.allocInHotPath;
    const cpuHotspots = cpu.report.hotspots.filter(isActionableFrame);
    const memAllocators = memory.report.hotAllocators.filter(isActionableFrame);
    if (cpuHotspots.length === 0 || memAllocators.length === 0) return [];

    const memByKey = new Map<string, MemoryHotAllocator>();
    for (const allocator of memAllocators) {
      memByKey.set(frameKey(allocator.function, allocator.file, allocator.line), allocator);
    }

    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const hotspot of cpuHotspots) {
      if (hotspot.totalPct < thresholds.minCpuTotalPct) continue;
      const key = frameKey(hotspot.function, hotspot.file, hotspot.line);
      if (seen.has(key)) continue;
      const allocator = memByKey.get(key);
      if (!allocator) continue;
      if (allocator.totalPct < thresholds.minAllocTotalPct) continue;
      seen.add(key);
      findings.push(buildFinding(hotspot, allocator));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  allocator: MemoryHotAllocator,
): BaseFinding<string, Record<string, unknown>> {
  const thresholds = DETECTOR_THRESHOLDS.allocInHotPath;
  const combined = hotspot.totalPct + allocator.totalPct;
  const severity: BaseFinding['severity'] =
    combined >= thresholds.criticalCombinedPct ? 'critical' : 'warning';
  return {
    id: `alloc-in-hot-path:${allocator.id}`,
    profileKind: 'memory',
    severity,
    category: 'alloc-in-hot-path',
    title: `${hotspot.function} is hot on CPU and a top allocator`,
    confidence: 'high',
    proofLevel: 'direct-sample',
    evidence: {
      file: hotspot.file,
      line: hotspot.line,
      function: hotspot.function,
      selfPct: hotspot.selfPct,
      ...((hotspot.source ?? allocator.source)
        ? { source: hotspot.source ?? allocator.source }
        : {}),
      extra: {
        cpuSelfPct: hotspot.selfPct,
        cpuTotalPct: hotspot.totalPct,
        allocSelfPct: allocator.selfPct,
        allocTotalPct: allocator.totalPct,
        allocSelfBytes: allocator.selfBytes,
        allocTotalBytes: allocator.totalBytes,
        combinedPct: combined,
        ...(allocator.package ? { package: allocator.package } : {}),
      },
    },
    measurements: {
      observed: {
        cpuTotalPct: hotspot.totalPct,
        allocTotalPct: allocator.totalPct,
        combinedPct: combined,
      },
      thresholds: {
        minCpuTotalPct: thresholds.minCpuTotalPct,
        minAllocTotalPct: thresholds.minAllocTotalPct,
        criticalCombinedPct: thresholds.criticalCombinedPct,
      },
    },
    why: `The same frame is responsible for ${hotspot.totalPct.toFixed(1)}% of on-CPU time AND ${allocator.totalPct.toFixed(1)}% of sampled allocations. Object construction is often the cause of both: every allocation costs cycles, then later costs more cycles in GC.`,
    suggestion:
      'Reduce allocations on this path: pool/reuse objects, replace map/filter chains with for-loops, avoid intermediate objects (string concatenation, JSON, spread). Check whether the work can be moved off the hot request path entirely (background batch / cache).',
    references: [
      'https://v8.dev/blog/free-garbage-collection',
      'https://v8.dev/blog/elements-kinds',
    ],
  };
}

function frameKey(fn: string, file: string, line: number): string {
  return `${file}::${fn}::${line}`;
}

function isActionableFrame(
  frame: Pick<Hotspot | MemoryHotAllocator, 'category' | 'file' | 'function'>,
) {
  if (frame.category !== 'user' && frame.category !== 'node_modules') return false;
  if (frame.file.startsWith('node:')) return false;
  if (/^(?:native |extensions::|evalmachine\.|node:internal\/)/.test(frame.file)) return false;
  if (/^\((?:root|idle|program|garbage collector|anonymous)\)$/.test(frame.function)) {
    return false;
  }
  return true;
}
