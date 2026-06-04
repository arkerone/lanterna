import { describe, expect, it } from 'vitest';
import { normalizeProfileOptions } from '../src/options-policy.js';

describe('CLI options policy', () => {
  it('applies default profiling options behind one policy interface', () => {
    expect(normalizeProfileOptions({}).kinds).toEqual(['cpu']);
    expect(normalizeProfileOptions({}).format).toBe('json');
  });

  it('enforces kind-scoped async options', () => {
    expect(() => normalizeProfileOptions({ asyncStackDepth: 32 })).toThrow(
      /--async-\* options require --kind async/,
    );
    expect(normalizeProfileOptions({ kind: ['async'], asyncStackDepth: 32 }).asyncStackDepth).toBe(
      32,
    );
  });
});
