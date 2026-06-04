import type { MemoryHotAllocator, UserCallerAttribution } from '@lanterna-profiler/core';
import { describe, expect, it } from 'vitest';
import {
  allocatorUserCaller,
  buildMemoryFinding,
  formatBytes,
  isActionableMemoryFrame,
} from '../../../src/detectors/shared/memory-finding.js';

function allocator(overrides: Partial<MemoryHotAllocator> = {}): MemoryHotAllocator {
  return {
    id: 'a1',
    function: 'allocateCache',
    file: '/app/src/cache.ts',
    line: 12,
    column: 2,
    category: 'user',
    selfBytes: 2048,
    selfPct: 5,
    totalBytes: 4096,
    totalPct: 20,
    callers: [],
    callees: [],
    ...overrides,
  };
}

describe('memory finding helper seam', () => {
  it('builds memory findings with consistent profile kind and frame evidence', () => {
    const finding = buildMemoryFinding({
      id: 'large-allocator:a1',
      severity: 'warning',
      category: 'large-allocator',
      title: 'large allocator',
      confidence: 'high',
      proofLevel: 'direct-sample',
      frame: allocator({ source: { file: 'src/cache.ts', line: 8 } }),
      extra: { totalBytes: 4096 },
      measurements: {
        observed: { totalPct: 20 },
        thresholds: { minTotalPct: 15 },
      },
      why: 'why',
      suggestion: 'suggestion',
      references: ['https://v8.dev/blog/memory'],
    });

    expect(finding.profileKind).toBe('memory');
    expect(finding.evidence).toMatchObject({
      file: '/app/src/cache.ts',
      line: 12,
      function: 'allocateCache',
      selfPct: 5,
      source: { file: 'src/cache.ts', line: 8 },
      extra: { totalBytes: 4096 },
    });
  });

  it('centralizes actionability and allocator caller fallback rules', () => {
    const explicitCaller: UserCallerAttribution = {
      function: 'route',
      file: '/app/src/server.ts',
      line: 4,
      profilePct: 8,
      supportPct: 90,
      confidence: 'high',
      basis: 'heap-sample-path',
    };

    expect(allocatorUserCaller(allocator({ userCaller: explicitCaller }))).toBe(explicitCaller);
    expect(allocatorUserCaller(allocator())).toMatchObject({
      function: 'allocateCache',
      file: '/app/src/cache.ts',
      line: 12,
      confidence: 'high',
      basis: 'heap-sample-path',
    });
    expect(allocatorUserCaller(allocator({ category: 'node_modules' }))).toBeUndefined();

    expect(isActionableMemoryFrame(allocator())).toBe(true);
    expect(isActionableMemoryFrame(allocator({ function: '(anonymous)' }))).toBe(false);
    expect(isActionableMemoryFrame(allocator({ file: 'node:internal/buffer' }))).toBe(false);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
