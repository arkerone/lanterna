import type {
  MemoryHotAllocator,
  MemorySummary,
  SummaryUserHotspot,
} from '@lanterna-profiler/core';

export interface CorrelatedAllocatorEvidence {
  function: string;
  file: string;
  line: number;
  totalPct: number;
  selfPct?: number;
  basis?: 'heap-sampled-allocator' | 'cpu-top-user-hotspot';
  userCaller?: MemoryHotAllocator['userCaller'];
  source?: MemoryHotAllocator['source'];
}

export function correlatedAllocatorFromMemory(
  summary: MemorySummary,
  hotAllocators: readonly MemoryHotAllocator[],
): CorrelatedAllocatorEvidence | undefined {
  const topAllocator = summary.topAllocator;
  if (!topAllocator) return undefined;
  const selected = selectMemoryAllocator(topAllocator, hotAllocators);
  if (!selected) return undefined;
  return {
    function: selected.function,
    file: selected.file,
    line: selected.line,
    totalPct: selected.totalPct,
    selfPct: selected.selfPct,
    basis: 'heap-sampled-allocator',
    ...(selected.userCaller ? { userCaller: selected.userCaller } : {}),
    ...(selected.source ? { source: selected.source } : {}),
  };
}

export function correlatedAllocatorFromCpuHotspot(
  hotspot: SummaryUserHotspot | undefined,
): CorrelatedAllocatorEvidence | undefined {
  if (!hotspot || isAnonymousFunction(hotspot.function)) return undefined;
  return {
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    totalPct: hotspot.totalPct,
    selfPct: hotspot.selfPct,
    basis: 'cpu-top-user-hotspot',
    ...(hotspot.source ? { source: hotspot.source } : {}),
  };
}

function selectMemoryAllocator(
  topAllocator: NonNullable<MemorySummary['topAllocator']>,
  hotAllocators: readonly MemoryHotAllocator[],
): MemoryHotAllocator | NonNullable<MemorySummary['topAllocator']> | undefined {
  const topHotAllocator = hotAllocators.find(
    (allocator) =>
      allocator.function === topAllocator.function &&
      allocator.file === topAllocator.file &&
      allocator.line === topAllocator.line,
  );
  if (topHotAllocator && isEditableNamedAllocator(topHotAllocator)) return topHotAllocator;
  if (!topHotAllocator && !isAnonymousFunction(topAllocator.function)) return topAllocator;
  return findNamedUserAllocator(hotAllocators, topAllocator.file);
}

function findNamedUserAllocator(
  hotAllocators: readonly MemoryHotAllocator[],
  preferredFile: string,
): MemoryHotAllocator | undefined {
  return (
    // Prefer a named user/node_modules allocator from the dominant file.
    hotAllocators.find(
      (allocator) => isEditableNamedAllocator(allocator) && allocator.file === preferredFile,
    ) ??
    // Then any named user/node_modules allocator.
    hotAllocators.find(isEditableNamedAllocator) ??
    // Finally fall back to an anonymous user/node_modules allocator: V8 names
    // arrow functions assigned to const/let via name inference, but inline
    // callbacks (`setInterval(() => ...)`, `.map(x => ...)`, `new Promise((r) => ...)`)
    // stay `(anonymous)`. The file:line is still actionable for an agent.
    hotAllocators.find(isEditableUserAllocator)
  );
}

function isEditableNamedAllocator(
  allocator: Pick<MemoryHotAllocator, 'category' | 'file' | 'function'>,
): boolean {
  return isEditableUserAllocator(allocator) && !isAnonymousFunction(allocator.function);
}

function isEditableUserAllocator(
  allocator: Pick<MemoryHotAllocator, 'category' | 'file'>,
): boolean {
  return (
    (allocator.category === 'user' || allocator.category === 'node_modules') &&
    !isRuntimePath(allocator.file)
  );
}

function isAnonymousFunction(fn: string): boolean {
  return fn === '(anonymous)' || fn.trim() === '';
}

function isRuntimePath(file: string): boolean {
  return file.startsWith('node:') || file.includes('/node_modules/');
}
