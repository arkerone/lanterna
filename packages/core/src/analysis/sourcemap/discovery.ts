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
    // http(s):// or other remote schemes — not supported for now.
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
