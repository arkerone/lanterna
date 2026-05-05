import type { BaseFinding, Finding, KindScopedDetector } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';

/**
 * Fires for frames that account for more than `minTotalPct` of all sampled
 * allocations. This is the allocation analogue of CPU hotspots.
 */
export const largeAllocatorDetector: KindScopedDetector<'memory'> = {
  id: 'large-allocator',
  kindIds: ['memory'],
  detect({ memory }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.largeAllocator;
    const allocators = memory.report.hotAllocators.filter(isActionableAllocator);
    if (allocators.length === 0) return [];

    const findings: Finding[] = [];
    const emittedSubtrees = new Set<string>();
    for (const allocator of allocators) {
      if (findings.length >= thresholds.maxFindings) break;
      const score = Math.max(allocator.totalPct, allocator.selfPct);
      if (score < thresholds.minTotalPct) continue;
      const subtreeKey = allocationSubtreeKey(allocator);
      if (emittedSubtrees.has(subtreeKey) && isInclusiveWrapper(allocator)) continue;
      emittedSubtrees.add(subtreeKey);
      findings.push(buildFinding(allocator, score));
    }
    return findings;
  },
};

function isActionableAllocator(allocator: import('@lanterna-profiler/core').MemoryHotAllocator) {
  if (allocator.category !== 'user' && allocator.category !== 'node_modules') return false;
  if (allocator.file.startsWith('node:')) return false;
  if (/^(?:native |extensions::|evalmachine\.|node:internal\/)/.test(allocator.file)) return false;
  if (/^\((?:root|idle|program|garbage collector|anonymous)\)$/.test(allocator.function)) {
    return false;
  }
  return true;
}

function allocationSubtreeKey(
  allocator: import('@lanterna-profiler/core').MemoryHotAllocator,
): string {
  return `${Math.round(allocator.totalBytes / 1024)}:${Math.round(allocator.totalPct * 10)}`;
}

function isInclusiveWrapper(allocator: import('@lanterna-profiler/core').MemoryHotAllocator) {
  if (allocator.totalBytes <= 0) return false;
  return allocator.selfBytes / allocator.totalBytes < 0.05;
}

function buildFinding(
  allocator: import('@lanterna-profiler/core').MemoryHotAllocator,
  score: number,
): BaseFinding<string, Record<string, unknown>> {
  const thresholds = DETECTOR_THRESHOLDS.largeAllocator;
  const severity: BaseFinding['severity'] =
    score >= thresholds.criticalTotalPct ? 'critical' : 'warning';
  const totalMB = allocator.totalBytes / (1024 * 1024);
  return {
    id: `large-allocator:${allocator.id}`,
    profileKind: 'memory',
    severity,
    category: 'large-allocator',
    title: `${allocator.function} accounts for ${score.toFixed(1)}% of sampled allocations`,
    confidence: 'high',
    proofLevel: 'direct-sample',
    evidence: {
      file: allocator.file,
      line: allocator.line,
      function: allocator.function,
      selfPct: allocator.selfPct,
      ...(allocator.source ? { source: allocator.source } : {}),
      extra: {
        category: allocator.category,
        ...(allocator.package ? { package: allocator.package } : {}),
        selfBytes: allocator.selfBytes,
        totalBytes: allocator.totalBytes,
        selfPct: allocator.selfPct,
        totalPct: allocator.totalPct,
        totalMB,
      },
    },
    measurements: {
      observed: {
        selfPct: allocator.selfPct,
        totalPct: allocator.totalPct,
        totalMB,
      },
      thresholds: {
        minTotalPct: thresholds.minTotalPct,
        criticalTotalPct: thresholds.criticalTotalPct,
      },
    },
    why: `This frame allocated ${formatBytes(allocator.totalBytes)} (${allocator.totalPct.toFixed(1)}% of sampled bytes). Even if the objects are short-lived, allocation pressure drives GC pauses and steals CPU from real work.`,
    suggestion:
      allocator.category === 'node_modules'
        ? `Allocation pressure originates in \`${allocator.package ?? 'a third-party package'}\`. Check whether you can reuse buffers/objects across calls, switch to a streaming API, or replace the dependency.`
        : 'Pool or reuse objects on the hot path: pre-allocate Buffers, reuse arrays/objects, avoid map+filter+slice chains that allocate intermediate arrays. For string-heavy code, prefer template-free concatenation and avoid `JSON.stringify` of large objects on every call.',
    references: [
      'https://nodejs.org/en/learn/diagnostics/memory/using-gc-traces',
      'https://v8.dev/blog/memory',
    ],
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
