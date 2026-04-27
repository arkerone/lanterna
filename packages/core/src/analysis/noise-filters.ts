import type { FrameCategory } from '../report/types.js';

/**
 * A noise filter knows how to identify samples / retainer chains that come
 * from the *profiler itself* (or any other instrumentation we want to keep
 * out of the public report). Filters are registered globally; their results
 * are consumed by the analyzers that build the CPU and memory sections.
 *
 * Adding a new filter is the recommended way to teach Lanterna about a new
 * source of self-noise (for example, a future async-hooks profile kind that
 * runs JS inside the target). Implementations should be pure and cheap —
 * they run on every classified frame.
 */
export interface NoiseFilter {
  /** Human-readable id, used in debug output. */
  name: string;
  /**
   * Frame category to assign when a sample matches this filter. Currently
   * only `'lanterna'` is supported by the schema; extending the
   * `FrameCategory` enum is required before introducing a new value.
   */
  category: FrameCategory;
  /**
   * Inspects a normalized fs path / URL (POSIX separators, no `file://`
   * prefix). Returns a stable short label when the path belongs to this
   * filter's domain, `undefined` otherwise.
   */
  matchUrl?: (normalizedPath: string) => string | undefined;
  /** Inspects a `node_modules` package name. */
  matchPackage?: (packageName: string) => string | undefined;
  /**
   * Inspects a heap-snapshot retainer path joined with spaces. Returning
   * `true` causes the path to be filtered out of the public report.
   */
  matchRetainerPath?: (joinedPath: string) => boolean;
}

export interface NoiseUrlMatch {
  category: FrameCategory;
  label: string;
  filter: string;
}

const filters: NoiseFilter[] = [];
const noiseCategories = new Set<FrameCategory>();

export function registerNoiseFilter(filter: NoiseFilter): void {
  filters.push(filter);
  noiseCategories.add(filter.category);
}

export function getRegisteredNoiseFilters(): readonly NoiseFilter[] {
  return filters;
}

export function isNoiseCategory(category: FrameCategory): boolean {
  return noiseCategories.has(category);
}

/**
 * Whether the consumer should keep noise frames in the public report. Set
 * `LANTERNA_DEBUG_SELF=1` to retain them when working on Lanterna itself or
 * on a registered noise source.
 */
export function shouldKeepNoiseFrames(): boolean {
  return process.env.LANTERNA_DEBUG_SELF === '1';
}

export function classifyNoiseUrl(normalizedPath: string): NoiseUrlMatch | undefined {
  for (const filter of filters) {
    const label = filter.matchUrl?.(normalizedPath);
    if (label) return { category: filter.category, label, filter: filter.name };
  }
  return undefined;
}

export function classifyNoisePackage(packageName: string): NoiseUrlMatch | undefined {
  for (const filter of filters) {
    const label = filter.matchPackage?.(packageName);
    if (label) return { category: filter.category, label, filter: filter.name };
  }
  return undefined;
}

export function isNoiseRetainerPath(path: readonly string[]): boolean {
  if (filters.length === 0) return false;
  const joined = path.join(' ');
  for (const filter of filters) {
    if (filter.matchRetainerPath?.(joined)) return true;
  }
  return false;
}

// ── Bundled filter: Lanterna's own instrumentation ───────────────────────────
// Catches the spawn-injected preload tmpfile, every source under
// runtime-signals/hooks/, lanterna's `node_modules` packages, and the heap
// retention chains that go through `__LANTERNA_*` globals or through
// node:perf_hooks' `kObservers` Set (which retains the PerformanceObserver
// installed by event-loop-hook.cjs).

const PRELOAD_TMPFILE_RE = /(^|\/)lanterna-preload-[^/]+\.cjs$/;
const RUNTIME_SIGNALS_HOOK_RE =
  /(^|\/)(?:src|dist|dist-test)\/runtime-signals\/(?:hooks\/)?(?:installers\/)?([^/]+?)\.(?:cjs|js|mjs|ts|cts|mts)$/;

const LANTERNA_RETAINER_SIGNATURES = [
  'lanterna-preload',
  'event-loop-hook',
  '__LANTERNA_',
  'lanterna:preload',
];

registerNoiseFilter({
  name: 'lanterna',
  category: 'lanterna',
  matchUrl(normalized) {
    if (PRELOAD_TMPFILE_RE.test(normalized)) return 'lanterna:preload';
    const hookMatch = normalized.match(RUNTIME_SIGNALS_HOOK_RE);
    if (hookMatch) return `lanterna:${hookMatch[2]}`;
    return undefined;
  },
  matchPackage(packageName) {
    if (packageName === 'lanterna') return 'lanterna:lanterna';
    if (packageName.startsWith('@lanterna/')) return `lanterna:${packageName}`;
    if (packageName.startsWith('@lanterna-profiler/')) return `lanterna:${packageName}`;
    return undefined;
  },
  matchRetainerPath(joined) {
    if (LANTERNA_RETAINER_SIGNATURES.some((signature) => joined.includes(signature))) return true;
    // The PerformanceObserver registered by event-loop-hook.cjs is retained
    // by node:perf_hooks via its internal `kObservers` Set. Those retainer
    // chains never mention Lanterna by name but represent our own
    // instrumentation, not the user's application. User-created
    // PerformanceObservers go through the same chain; the trade-off is
    // documented but acceptable given how rare user observers are in
    // profiled workloads. Set LANTERNA_DEBUG_SELF=1 to see them.
    if (
      joined.includes('kObservers') &&
      /PerformanceObserver|observerCallback|enqueue/.test(joined)
    ) {
      return true;
    }
    return false;
  },
});
