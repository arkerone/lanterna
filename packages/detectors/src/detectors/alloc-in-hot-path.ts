import type {
  BaseFinding,
  Finding,
  Hotspot,
  KindScopedDetector,
  MemoryHotAllocator,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import { selfHotspotUserCaller } from './shared.js';

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
    const actionableMemAllocators = memory.report.hotAllocators.filter(isActionableFrame);
    const dominantAllocator = memory.report.hotAllocators.find(
      (allocator) => allocator.totalPct >= thresholds.minAllocTotalPct,
    );
    if (cpuHotspots.length === 0) return [];

    const memByKey = new Map<string, MemoryHotAllocator>();
    for (const allocator of actionableMemAllocators) {
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
    if (
      findings.length === 0 &&
      dominantAllocator &&
      isDominantSystemAllocator(dominantAllocator)
    ) {
      const correlated = findCpuCorrelatedAllocator(
        cpu.report.hotspots,
        cpuHotspots,
        dominantAllocator,
      );
      if (correlated) findings.push(buildFinding(correlated, dominantAllocator));
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
  const userCaller =
    hotspot.userCaller ??
    (hotspot.category === 'user' ? selfHotspotUserCaller(hotspot) : undefined) ??
    allocatorUserCaller(allocator);
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
        ...(userCaller ? { userCaller } : {}),
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

function allocatorUserCaller(allocator: MemoryHotAllocator): UserCallerAttribution | undefined {
  if (allocator.userCaller) return allocator.userCaller;
  if (allocator.category !== 'user') return undefined;
  return {
    function: allocator.function,
    file: allocator.file,
    line: allocator.line,
    column: allocator.column,
    ...(allocator.source ? { source: allocator.source } : {}),
    stackDistance: 0,
    profilePct: allocator.totalPct,
    supportPct: 100,
    confidence: 'high',
    basis: 'heap-sample-path',
  };
}

function frameKey(fn: string, file: string, line: number): string {
  return `${file}::${fn}::${line}`;
}

function findCpuCorrelatedAllocator(
  allHotspots: readonly Hotspot[],
  cpuHotspots: readonly Hotspot[],
  allocator: MemoryHotAllocator,
): Hotspot | undefined {
  const thresholds = DETECTOR_THRESHOLDS.allocInHotPath;
  const minSystemCpuPct = thresholds.minCpuTotalPct;
  const hotspotById = new Map(allHotspots.map((hotspot) => [hotspot.id, hotspot]));
  let best: { hotspot: Hotspot; systemCpuPct: number } | undefined;
  for (const hotspot of cpuHotspots) {
    if (hotspot.totalPct < thresholds.minCpuTotalPct) continue;
    const systemCpuPct = Math.max(
      attributedSystemCpuPct(allHotspots, hotspot),
      systemCalleeCpuPct(hotspot, hotspotById),
    );
    if (systemCpuPct < minSystemCpuPct) continue;
    if (!best || hotspot.totalPct + systemCpuPct > best.hotspot.totalPct + best.systemCpuPct) {
      best = { hotspot, systemCpuPct };
    }
  }
  if (!best) return undefined;
  if (allocator.totalPct + best.hotspot.totalPct < thresholds.criticalCombinedPct) {
    return undefined;
  }
  return best.hotspot;
}

function systemCalleeCpuPct(hotspot: Hotspot, hotspotById: ReadonlyMap<string, Hotspot>): number {
  return hotspot.callees.reduce((total, callee) => {
    const calleeHotspot = hotspotById.get(callee.id);
    if (!calleeHotspot || isActionableFrame(calleeHotspot)) return total;
    return total + callee.pct;
  }, 0);
}

function attributedSystemCpuPct(allHotspots: readonly Hotspot[], userHotspot: Hotspot): number {
  return allHotspots.reduce((total, hotspot) => {
    if (isActionableFrame(hotspot)) return total;
    return userCallerMatchesHotspot(hotspot.userCaller, userHotspot)
      ? total + hotspot.totalPct
      : total;
  }, 0);
}

function userCallerMatchesHotspot(
  caller: UserCallerAttribution | undefined,
  hotspot: Hotspot,
): boolean {
  return (
    caller?.function === hotspot.function &&
    caller.file === hotspot.file &&
    caller.line === hotspot.line
  );
}

function isDominantSystemAllocator(allocator: MemoryHotAllocator): boolean {
  return !isActionableFrame(allocator) && allocator.totalPct >= 40;
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
