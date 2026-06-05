import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Maximum bytes read from the tail of a JS file when looking for its
 * `//# sourceMappingURL=` comment. Real-world bundles place this on the last
 * line; 8 KiB is comfortably more than any realistic banner.
 */
const SOURCE_MAPPING_TAIL_BYTES = 8 * 1024;

/** Hard cap to avoid loading pathologically large `.map` files into memory. */
const MAX_MAP_BYTES = 50 * 1024 * 1024;

const SOURCE_MAPPING_URL_RE = /[/][/*]#\s*sourceMappingURL=([^\s'"]+)\s*[*]?[/]?\s*$/m;

export interface DiscoveredMap {
  /** Absolute path of the generated JS file. */
  generatedPath: string;
  /** Directory used to resolve sources referenced from the map. */
  mapDir: string;
  /** Parsed raw source map JSON. */
  raw: unknown;
}

export type DiscoveryFailureReason =
  | 'not-file-url'
  | 'js-read-failed'
  | 'no-mapping-url'
  | 'map-read-failed'
  | 'map-parse-failed'
  | 'map-too-large'
  | 'unsupported-mapping-url';

export interface DiscoveryFailure {
  url: string;
  reason: DiscoveryFailureReason;
  detail?: string;
}

export interface DiscoveryResult {
  map?: DiscoveredMap;
  failure?: DiscoveryFailure;
}

/**
 * Attempt to discover and load the source map associated with a generated
 * script URL emitted by V8. Sync on purpose: we run analysis once after
 * capture stops, blocking briefly is preferable to cascading async signatures.
 */
export function discoverSourceMap(url: string): DiscoveryResult {
  const generatedPath = filesystemPathFromUrl(url);
  if (!generatedPath) {
    return { failure: { url, reason: 'not-file-url' } };
  }

  let tail: string;
  try {
    tail = readFileTail(generatedPath, SOURCE_MAPPING_TAIL_BYTES);
  } catch (error) {
    return { failure: { url, reason: 'js-read-failed', detail: errorMessage(error) } };
  }

  const mappingUrl = SOURCE_MAPPING_URL_RE.exec(tail)?.[1];
  if (!mappingUrl) {
    return { failure: { url, reason: 'no-mapping-url' } };
  }

  if (mappingUrl.startsWith('data:')) {
    const parsed = parseInlineDataUrl(mappingUrl);
    if (!parsed.ok) {
      return { failure: { url, reason: parsed.reason, detail: parsed.detail } };
    }
    return {
      map: { generatedPath, mapDir: dirname(generatedPath), raw: parsed.raw },
    };
  }

  if (mappingUrl.includes('://')) {
    // Remote http(s) maps are supported only when pre-fetched into the cache
    // (opt-in) — `discoverSourceMap` itself stays synchronous. Other schemes
    // (e.g. `file://` mapping URLs) remain unsupported.
    if (isRemoteMappingUrl(mappingUrl)) {
      const cached = remoteMapCache.get(mappingUrl);
      if (cached !== undefined) {
        try {
          return {
            map: { generatedPath, mapDir: dirname(generatedPath), raw: JSON.parse(cached) },
          };
        } catch (error) {
          return { failure: { url, reason: 'map-parse-failed', detail: errorMessage(error) } };
        }
      }
    }
    return { failure: { url, reason: 'unsupported-mapping-url', detail: mappingUrl } };
  }

  const mapPath = isAbsolute(mappingUrl)
    ? mappingUrl
    : resolvePath(dirname(generatedPath), mappingUrl);

  let mapText: string;
  try {
    const stats = statSafely(mapPath);
    if (stats && stats.size > MAX_MAP_BYTES) {
      return { failure: { url, reason: 'map-too-large', detail: `${stats.size} bytes` } };
    }
    mapText = readFileSync(mapPath, 'utf8');
  } catch (error) {
    return { failure: { url, reason: 'map-read-failed', detail: errorMessage(error) } };
  }

  try {
    const raw = JSON.parse(mapText);
    return { map: { generatedPath, mapDir: dirname(mapPath), raw } };
  } catch (error) {
    return { failure: { url, reason: 'map-parse-failed', detail: errorMessage(error) } };
  }
}

// ---------------------------------------------------------------------------
// Remote source maps (opt-in)
//
// `discoverSourceMap` is synchronous by design. To support `//# sourceMappingURL`
// pointing at an `http(s)://` URL without making the whole analysis pipeline
// async, remote maps are fetched up-front by `prefetchRemoteSourceMaps` into this
// module-level cache, which the sync discovery then reads. The cache is keyed by
// the literal mapping URL.
// ---------------------------------------------------------------------------

const remoteMapCache = new Map<string, string>();
const REMOTE_FETCH_TIMEOUT_MS = 3_000;

function isRemoteMappingUrl(mappingUrl: string): boolean {
  return /^https?:\/\//i.test(mappingUrl);
}

/** Reads the `//# sourceMappingURL=` value for a generated script URL, if any. */
export function readMappingUrl(generatedUrl: string): string | undefined {
  const generatedPath = filesystemPathFromUrl(generatedUrl);
  if (!generatedPath) return undefined;
  let tail: string;
  try {
    tail = readFileTail(generatedPath, SOURCE_MAPPING_TAIL_BYTES);
  } catch {
    return undefined;
  }
  return SOURCE_MAPPING_URL_RE.exec(tail)?.[1];
}

export interface PrefetchRemoteOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetches the remote (`http(s)://`) source maps referenced by the given generated
 * script URLs into the module cache, so the synchronous {@link discoverSourceMap}
 * can resolve them. Best-effort: failed or oversized fetches are skipped silently
 * (they fall back to `unsupported-mapping-url`). Opt-in — only call when the user
 * has allowed remote source-map fetching (network egress).
 */
export async function prefetchRemoteSourceMaps(
  urls: Iterable<string>,
  options: PrefetchRemoteOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? REMOTE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_MAP_BYTES;
  const pending = new Set<string>();
  for (const url of urls) {
    const mappingUrl = readMappingUrl(url);
    if (mappingUrl && isRemoteMappingUrl(mappingUrl) && !remoteMapCache.has(mappingUrl)) {
      pending.add(mappingUrl);
    }
  }
  await Promise.all(
    [...pending].map(async (mappingUrl) => {
      const text = await fetchRemoteMap(mappingUrl, timeoutMs, maxBytes);
      if (text !== undefined) remoteMapCache.set(mappingUrl, text);
    }),
  );
}

/** Clears the remote source-map cache (test seam). */
export function clearRemoteSourceMapCache(): void {
  remoteMapCache.clear();
}

async function fetchRemoteMap(
  mappingUrl: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(mappingUrl, { signal: controller.signal });
    if (!response.ok) return undefined;
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return undefined;
    const text = await response.text();
    if (text.length > maxBytes) return undefined;
    return text;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function filesystemPathFromUrl(url: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('file://')) {
    try {
      return fileURLToPath(url);
    } catch {
      return undefined;
    }
  }
  if (isAbsolute(url)) return url;
  return undefined;
}

function readFileTail(path: string, maxBytes: number): string {
  // Two reasons to read the whole file: small files where slicing is moot, and
  // the simplicity of relying on Node's stdlib without juggling fd positions.
  // For very large bundles (>1 MiB) we still read it all — JS bundles past
  // that size are uncommon for profiled apps and the extra read time is
  // negligible compared to the analysis pipeline.
  const buffer = readFileSync(path);
  if (buffer.length <= maxBytes) return buffer.toString('utf8');
  return buffer.subarray(buffer.length - maxBytes).toString('utf8');
}

function statSafely(path: string): { size: number } | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

interface ParsedInline {
  ok: true;
  raw: unknown;
}
interface InlineParseFailure {
  ok: false;
  reason: 'map-parse-failed' | 'unsupported-mapping-url';
  detail?: string;
}

function parseInlineDataUrl(dataUrl: string): ParsedInline | InlineParseFailure {
  // Accept `data:application/json;base64,<...>` and `data:application/json,<...>` (uri-encoded).
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) {
    return { ok: false, reason: 'unsupported-mapping-url', detail: dataUrl.slice(0, 32) };
  }
  const meta = dataUrl.slice(5, commaIdx); // strip "data:"
  const payload = dataUrl.slice(commaIdx + 1);
  let text: string;
  try {
    if (/;base64$/i.test(meta) || /;base64;/i.test(meta)) {
      text = Buffer.from(payload, 'base64').toString('utf8');
    } else {
      text = decodeURIComponent(payload);
    }
  } catch (error) {
    return { ok: false, reason: 'map-parse-failed', detail: errorMessage(error) };
  }
  try {
    return { ok: true, raw: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: 'map-parse-failed', detail: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
