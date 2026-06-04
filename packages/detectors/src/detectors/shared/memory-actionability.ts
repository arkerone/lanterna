import type { FrameCategory, MemoryHotAllocator } from '@lanterna-profiler/core';

export function isRuntimeAllocatorPath(file: string): boolean {
  return (
    file.startsWith('node:') || /^(?:native |extensions::|evalmachine\.|node:internal\/)/.test(file)
  );
}

export function isEditableMemoryAllocator(
  allocator: Pick<MemoryHotAllocator, 'category' | 'file'>,
): boolean {
  return (
    (allocator.category === 'user' || allocator.category === 'node_modules') &&
    !isRuntimeAllocatorPath(allocator.file)
  );
}

export function isActionableMemoryFrame(frame: {
  readonly category: FrameCategory;
  readonly file: string;
  readonly function: string;
}): boolean {
  if (!isEditableMemoryAllocator(frame)) return false;
  if (/^\((?:root|idle|program|garbage collector|anonymous)\)$/.test(frame.function)) {
    return false;
  }
  return true;
}
