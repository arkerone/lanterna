import { isAbsolute, posix, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import type { SourceLocation, SourceMapsIntegrity } from '../../report/types.js';
import { type DiscoveryFailureReason, discoverSourceMap } from './discovery.js';

const FAILURES_CAP = 20;

export interface SourceMapResolver {
  /**
   * Pre-load source maps for all unique generated URLs that may be queried
   * later. Sync I/O — call once per analysis pass.
   */
  prepare(urls: Iterable<string>): void;

  /**
   * Look up the original source position for a generated `(url, line, column)`.
   * Inputs are 1-indexed (matching how Lanterna stores frames after V8
   * normalization). Returns `undefined` when the url is not file-based, no map
   * is available, or no mapping exists for the position.
   */
  resolve(url: string, line: number, column: number): SourceLocation | undefined;

  /** Snapshot of resolution counters for `meta.captureIntegrity.sourceMaps`. */
  integrity(): SourceMapsIntegrity;
}

interface ResolverState {
  enabled: boolean;
  cwd: string;
  prepared: Set<string>;
  maps: Map<string, TraceMap>;
  failures: Array<{ url: string; reason: string }>;
  framesResolved: number;
  framesUnresolved: number;
}

export interface CreateSourceMapResolverOptions {
  cwd: string;
  enabled?: boolean;
}

export function createSourceMapResolver(opts: CreateSourceMapResolverOptions): SourceMapResolver {
  const state: ResolverState = {
    enabled: opts.enabled ?? true,
    cwd: opts.cwd,
    prepared: new Set(),
    maps: new Map(),
    failures: [],
    framesResolved: 0,
    framesUnresolved: 0,
  };

  return {
    prepare(urls) {
      if (!state.enabled) return;
      for (const url of urls) {
        if (!url || state.prepared.has(url)) continue;
        // Lanterna's own preload hook is written to /tmp and removed before
        // analysis runs; it never has a source map of interest. Skip it so it
        // does not show up in `failures[]`.
        if (isLanternaPreloadUrl(url)) continue;
        state.prepared.add(url);
        const result = discoverSourceMap(url);
        if (result.map) {
          try {
            const traceMap = new TraceMap(
              result.map.raw as ConstructorParameters<typeof TraceMap>[0],
            );
            // Stash the map directory under a symbol-keyed property so the
            // resolver can join `sources` against it later.
            (traceMap as TraceMapWithDir).__lanternaMapDir = result.map.mapDir;
            state.maps.set(url, traceMap);
          } catch (error) {
            recordFailure(state, url, 'map-parse-failed', errorMessage(error));
          }
        } else if (result.failure) {
          // `not-file-url` and `no-mapping-url` are common and uninteresting
          // (node:builtin frames, plain JS apps without maps); skip those to
          // keep the failures array signal-only.
          const reason = result.failure.reason;
          if (reason !== 'not-file-url' && reason !== 'no-mapping-url') {
            recordFailure(state, url, reason, result.failure.detail);
          }
        }
      }
    },

    resolve(url, line, column) {
      if (!state.enabled) return undefined;
      const traceMap = state.maps.get(url);
      if (!traceMap) {
        // Only count frames that could plausibly carry a source map. Builtins
        // (`node:internal/...`), empty urls, and other non-filesystem schemes
        // would always be "unresolved" and would tank the coverage metric
        // without telling the reader anything actionable.
        if (isMappableUrl(url)) state.framesUnresolved += 1;
        return undefined;
      }
      // trace-mapping uses 1-based lines and 0-based columns; Lanterna stores
      // both 1-based after normalization.
      const original = originalPositionFor(traceMap, {
        line,
        column: Math.max(0, column - 1),
      });
      if (!original.source || original.line === null || original.line === undefined) {
        state.framesUnresolved += 1;
        return undefined;
      }
      const sourceFile = formatSourcePath(original.source, traceMap, state.cwd);
      const location: SourceLocation = {
        file: sourceFile,
        line: original.line,
      };
      if (original.column !== null && original.column !== undefined) {
        location.column = original.column + 1;
      }
      if (original.name) location.name = original.name;
      state.framesResolved += 1;
      return location;
    },

    integrity() {
      const total = state.framesResolved + state.framesUnresolved;
      return {
        enabled: state.enabled,
        framesResolved: state.framesResolved,
        framesUnresolved: state.framesUnresolved,
        coverage: total > 0 ? state.framesResolved / total : 0,
        mapsLoaded: state.maps.size,
        failures: state.failures.slice(),
      };
    },
  };
}

interface TraceMapWithDir extends TraceMap {
  __lanternaMapDir?: string;
}

function recordFailure(
  state: ResolverState,
  url: string,
  reason: DiscoveryFailureReason | 'map-parse-failed',
  detail?: string,
): void {
  if (state.failures.length >= FAILURES_CAP) return;
  state.failures.push({
    url,
    reason: detail ? `${reason}: ${detail}` : reason,
  });
}

function formatSourcePath(rawSource: string, traceMap: TraceMap, cwd: string): string {
  // trace-mapping returns sources that already factor in `sourceRoot` and
  // entries from the `sources` array. They may be absolute paths, file://
  // URLs, scheme-prefixed virtual paths (webpack://, vite:/), or relative
  // paths joined to the map directory.
  if (rawSource.startsWith('file://')) {
    try {
      return relativizeFs(fileURLToPath(rawSource), cwd);
    } catch {
      return rawSource;
    }
  }
  if (isVirtualSourcePath(rawSource)) {
    // Virtual scheme (webpack://, vite:/, etc.) — keep as-is so consumers can
    // see the bundler's logical path.
    return rawSource;
  }
  if (isAbsolute(rawSource)) {
    return relativizeFs(rawSource, cwd);
  }
  const mapDir = (traceMap as TraceMapWithDir).__lanternaMapDir;
  if (mapDir) {
    return relativizeFs(resolvePath(mapDir, rawSource), cwd);
  }
  return toPosix(rawSource);
}

function isMappableUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  if (isAbsolute(url)) return true;
  return false;
}

function isVirtualSourcePath(source: string): boolean {
  return source.includes('://') || /^[a-z][a-z\d+.-]*:\//i.test(source);
}

function isLanternaPreloadUrl(url: string): boolean {
  return url.includes('/lanterna-preload-') && url.endsWith('.cjs');
}

function relativizeFs(absolutePath: string, cwd: string): string {
  const rel = toPosix(relative(cwd, absolutePath));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return toPosix(absolutePath);
  return rel;
}

function toPosix(value: string): string {
  return sep === posix.sep ? value : value.split(sep).join(posix.sep);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Resolver that does nothing — useful when source-map support is disabled. */
export function createNoopSourceMapResolver(): SourceMapResolver {
  return {
    prepare() {},
    resolve() {
      return undefined;
    },
    integrity() {
      return {
        enabled: false,
        framesResolved: 0,
        framesUnresolved: 0,
        coverage: 0,
        mapsLoaded: 0,
        failures: [],
      };
    },
  };
}
