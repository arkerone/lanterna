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
  const allocator = selectCorrelatedMemoryAllocator(topAllocator, hotAllocators);
  if (!allocator) return undefined;
  return {
    function: allocator.function,
    file: allocator.file,
    line: allocator.line,
    totalPct: allocator.totalPct,
    selfPct: allocator.selfPct,
    basis: 'heap-sampled-allocator',
    ...(allocator.userCaller ? { userCaller: allocator.userCaller } : {}),
    ...(allocator.source ? { source: allocator.source } : {}),
  };
}

export function correlatedAllocatorFromCpuHotspot(
  hotspot: SummaryUserHotspot | undefined,
): CorrelatedAllocatorEvidence | undefined {
  if (!hotspot) return undefined;
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

function selectCorrelatedMemoryAllocator(
  topAllocator: NonNullable<MemorySummary['topAllocator']>,
  hotAllocators: readonly MemoryHotAllocator[],
): MemoryHotAllocator | NonNullable<MemorySummary['topAllocator']> | undefined {
  const matchingHotAllocator = hotAllocators.find(
    (allocator) =>
      allocator.function === topAllocator.function &&
      allocator.file === topAllocator.file &&
      allocator.line === topAllocator.line,
  );
  if (matchingHotAllocator && isEditableAllocator(matchingHotAllocator)) {
    return matchingHotAllocator;
  }
  // Summary topAllocator lacks `category`; treat it as editable when the path
  // is not a runtime path.
  if (!matchingHotAllocator && !isRuntimeAllocatorPath(topAllocator.file)) return topAllocator;
  return findEditableAllocatorForEvidence(hotAllocators, topAllocator.file);
}

/**
 * Returns the first editable allocator, preferring one from `preferredFile`.
 * Anonymous user-code wrappers remain editable because their file/line is
 * actionable.
 */
function findEditableAllocatorForEvidence(
  hotAllocators: readonly MemoryHotAllocator[],
  preferredFile: string,
): MemoryHotAllocator | undefined {
  return (
    hotAllocators.find(
      (allocator) => isEditableAllocator(allocator) && allocator.file === preferredFile,
    ) ?? hotAllocators.find(isEditableAllocator)
  );
}

/**
 * An allocator is "editable" when it belongs to user code or a `node_modules`
 * dependency. Runtime paths are excluded.
 */
function isEditableAllocator(allocator: Pick<MemoryHotAllocator, 'category' | 'file'>): boolean {
  return (
    (allocator.category === 'user' || allocator.category === 'node_modules') &&
    !isRuntimeAllocatorPath(allocator.file)
  );
}

function isRuntimeAllocatorPath(file: string): boolean {
  return file.startsWith('node:') || file.includes('/node_modules/');
}
