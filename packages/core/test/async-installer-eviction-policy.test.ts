import { describe, expect, it } from 'vitest';
import { selectAsyncRecordEvictionCandidate } from '../src/runtime-signals/hooks/installers/async-operations/source.js';

describe('async installer eviction policy', () => {
  it('selects the shortest completed record within the bounded scan window', () => {
    const records = new Map<number, { durationMs?: number }>([
      [1, { durationMs: 100 }],
      [2, { durationMs: 5 }],
      [3, { durationMs: 50 }],
      [4, { durationMs: 1 }],
    ]);
    const completed = new Set([1, 2, 3, 4]);

    expect(selectAsyncRecordEvictionCandidate(records, completed, 3)).toBe(2);
  });

  it('returns undefined when no completed record is available', () => {
    expect(selectAsyncRecordEvictionCandidate(new Map(), new Set(), 64)).toBeUndefined();
  });
});
