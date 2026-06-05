import { describe, expect, it } from 'vitest';
import { normalizeProfileOptions, validateKindScopedOptions } from '../src/options-policy.js';

describe('CLI options policy', () => {
  it('applies default profiling options behind one policy interface', () => {
    expect(normalizeProfileOptions({}).kinds).toEqual(['cpu']);
    expect(normalizeProfileOptions({}).format).toBe('json');
  });

  it('keeps async defaults dormant until a config value or flag activates them', () => {
    const options = normalizeProfileOptions({});

    expect(() =>
      validateKindScopedOptions(options, {
        config: undefined,
        providedFlags: new Set(),
      }),
    ).not.toThrow();
  });

  it('validates async flags after merged kinds are known', () => {
    const options = normalizeProfileOptions({ asyncStackDepth: 32 });

    expect(() =>
      validateKindScopedOptions(options, {
        config: undefined,
        providedFlags: new Set(['asyncStackDepth']),
      }),
    ).toThrow(/--async-\* options require --kind async/);

    expect(() =>
      validateKindScopedOptions(
        { ...options, kinds: ['async'] },
        {
          config: { kinds: ['async'] },
          providedFlags: new Set(['asyncStackDepth']),
        },
      ),
    ).not.toThrow();
    expect(normalizeProfileOptions({ kind: ['async'], asyncStackDepth: 32 }).asyncStackDepth).toBe(
      32,
    );
  });

  it('validates async config after config kinds are merged', () => {
    const options = normalizeProfileOptions({});

    expect(() =>
      validateKindScopedOptions(options, {
        config: { asyncStackDepth: 16 },
        providedFlags: new Set(),
      }),
    ).toThrow(/async options in Lanterna config require kind "async"/);

    expect(() =>
      validateKindScopedOptions(
        { ...options, kinds: ['async'], asyncStackDepth: 16 },
        {
          config: { kinds: ['async'], asyncStackDepth: 16 },
          providedFlags: new Set(),
        },
      ),
    ).not.toThrow();
  });

  it('validates heap snapshot flags and config after merged kinds are known', () => {
    const options = normalizeProfileOptions({ heapSnapshotAnalysis: true });

    expect(() =>
      validateKindScopedOptions(options, {
        config: undefined,
        providedFlags: new Set(['heapSnapshotAnalysis']),
      }),
    ).toThrow(/--heap-snapshot-analysis requires --kind memory/);

    expect(() =>
      validateKindScopedOptions(
        { ...options, kinds: ['memory'] },
        {
          config: undefined,
          providedFlags: new Set(['heapSnapshotAnalysis']),
        },
      ),
    ).not.toThrow();

    expect(() =>
      validateKindScopedOptions(normalizeProfileOptions({}), {
        config: { heapSnapshotAnalysis: { enabled: true } },
        providedFlags: new Set(),
      }),
    ).toThrow(/heap snapshot analysis in Lanterna config requires kind "memory"/);

    expect(() =>
      validateKindScopedOptions(normalizeProfileOptions({}), {
        config: { heapSnapshotAnalysis: { enabled: false } },
        providedFlags: new Set(),
      }),
    ).not.toThrow();
  });
});
