import { describe, expect, it } from 'vitest';
import {
  isActionableMemoryFrame,
  isEditableMemoryAllocator,
  isRuntimeAllocatorPath,
} from '../../../src/detectors/shared/memory-actionability.js';

describe('memory actionability', () => {
  it('treats node_modules dependency frames as actionable but runtime paths as non-actionable', () => {
    expect(
      isActionableMemoryFrame({
        category: 'node_modules',
        file: '/app/node_modules/pkg/index.js',
        function: 'allocate',
      }),
    ).toBe(true);
    expect(isRuntimeAllocatorPath('node:internal/buffer')).toBe(true);
    expect(
      isEditableMemoryAllocator({
        category: 'node_modules',
        file: 'node:internal/buffer',
      }),
    ).toBe(false);
  });
});
