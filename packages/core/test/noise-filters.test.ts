import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyNoisePackage,
  classifyNoiseUrl,
  getRegisteredNoiseFilters,
  isNoiseCategory,
  isNoiseRetainerPath,
  type NoiseFilter,
  registerNoiseFilter,
  shouldKeepNoiseFrames,
} from '../src/analysis/noise-filters.js';

describe('noise-filters: bundled lanterna filter', () => {
  it('classifies the spawn-injected preload tmpfile', () => {
    expect(classifyNoiseUrl('/tmp/lanterna-preload-123-456-abc.cjs')).toEqual({
      category: 'lanterna',
      label: 'lanterna:preload',
      filter: 'lanterna',
    });
  });

  it.each([
    ['src/runtime-signals/hooks/event-loop-hook.cjs', 'lanterna:event-loop-hook'],
    ['dist/runtime-signals/hooks/framework.js', 'lanterna:framework'],
    ['src/runtime-signals/hooks/installers/memory-usage.ts', 'lanterna:memory-usage'],
    [
      '/abs/path/dist-test/runtime-signals/hooks/installers/runtime-signals.ts',
      'lanterna:runtime-signals',
    ],
  ])('classifies hook source %s', (path, expectedLabel) => {
    expect(classifyNoiseUrl(path)?.label).toBe(expectedLabel);
  });

  it('does not match user code that happens to live in a similarly-named directory', () => {
    expect(classifyNoiseUrl('/app/src/services/runtime/hooks.ts')).toBeUndefined();
    expect(classifyNoiseUrl('/app/src/auth.ts')).toBeUndefined();
  });

  it.each([
    ['lanterna', 'lanterna:lanterna'],
    ['@lanterna/core', 'lanterna:@lanterna/core'],
    ['@lanterna-profiler/cli', 'lanterna:@lanterna-profiler/cli'],
  ])('classifies node_modules package %s as lanterna noise', (pkg, label) => {
    expect(classifyNoisePackage(pkg)?.label).toBe(label);
  });

  it('does not flag unrelated packages', () => {
    expect(classifyNoisePackage('lanterna-clone')).toBeUndefined();
    expect(classifyNoisePackage('@scope/foo')).toBeUndefined();
  });

  it.each([
    [
      'retainer with __LANTERNA_FRAMEWORK__ global',
      ['.2', 'global / .__LANTERNA_FRAMEWORK__', 'Object.api'],
    ],
    [
      'retainer through kObservers + observerCallback',
      [
        '.1',
        '(GC roots).10',
        'observerCallback.context',
        'system / Context.kObservers',
        'Set.table',
        '.5',
        'PerformanceObserver',
      ],
    ],
    [
      'retainer through lanterna-preload tmpfile name',
      ['lanterna-preload-123-456.cjs', 'whatever'],
    ],
  ])('flags %s as noise retainer path', (_label, path) => {
    expect(isNoiseRetainerPath(path)).toBe(true);
  });

  it('keeps user retainer paths', () => {
    expect(
      isNoiseRetainerPath([
        '.2',
        'global / .<symbol @@Temporal__GetSlots>',
        '.context',
        'system / Context',
      ]),
    ).toBe(false);
  });

  it('does not flag a bare PerformanceObserver chain without kObservers', () => {
    // User-instantiated PerformanceObserver that lives on `globalThis`
    expect(
      isNoiseRetainerPath([
        '.2',
        'global / .PerformanceObserver',
        'PerformanceObserver.prototype',
        'PerformanceObserver',
      ]),
    ).toBe(false);
  });

  it('reports lanterna as a noise category', () => {
    expect(isNoiseCategory('lanterna')).toBe(true);
    expect(isNoiseCategory('user')).toBe(false);
    expect(isNoiseCategory('node_modules')).toBe(false);
  });
});

describe('noise-filters: shouldKeepNoiseFrames', () => {
  let originalFlag: string | undefined;
  beforeEach(() => {
    originalFlag = process.env.LANTERNA_DEBUG_SELF;
  });
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.LANTERNA_DEBUG_SELF;
    else process.env.LANTERNA_DEBUG_SELF = originalFlag;
  });

  it('returns false by default', () => {
    delete process.env.LANTERNA_DEBUG_SELF;
    expect(shouldKeepNoiseFrames()).toBe(false);
  });

  it('returns true when LANTERNA_DEBUG_SELF is "1"', () => {
    process.env.LANTERNA_DEBUG_SELF = '1';
    expect(shouldKeepNoiseFrames()).toBe(true);
  });

  it('does not treat arbitrary truthy values as enabled', () => {
    process.env.LANTERNA_DEBUG_SELF = 'true';
    expect(shouldKeepNoiseFrames()).toBe(false);
  });
});

describe('noise-filters: registry extension', () => {
  // The registry is module-global on purpose. We can't easily un-register a
  // filter, so this test relies on a unique name + url shape that won't
  // collide with the bundled lanterna filter or with anything else we ship.

  const fixtureFilter: NoiseFilter = {
    name: 'test-async-hooks-fixture',
    category: 'lanterna', // reuse existing category — adding a new one would require schema changes
    matchUrl(normalized) {
      return normalized.endsWith('/__test-async-hooks-runtime__.js')
        ? 'test:async-hooks'
        : undefined;
    },
    matchRetainerPath(joined) {
      return joined.includes('__TEST_ASYNC_HOOKS_RUNTIME__');
    },
  };

  it('lets a third-party filter contribute to URL classification', () => {
    expect(classifyNoiseUrl('/app/__test-async-hooks-runtime__.js')).toBeUndefined();

    registerNoiseFilter(fixtureFilter);

    expect(classifyNoiseUrl('/app/__test-async-hooks-runtime__.js')).toEqual({
      category: 'lanterna',
      label: 'test:async-hooks',
      filter: 'test-async-hooks-fixture',
    });
  });

  it('lets a third-party filter contribute to retainer-path detection', () => {
    expect(isNoiseRetainerPath(['x', '__TEST_ASYNC_HOOKS_RUNTIME__', 'y'])).toBe(true);
  });

  it('exposes the filter via getRegisteredNoiseFilters', () => {
    expect(getRegisteredNoiseFilters().some((filter) => filter.name === fixtureFilter.name)).toBe(
      true,
    );
  });
});
