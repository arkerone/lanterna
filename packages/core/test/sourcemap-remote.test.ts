import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRemoteSourceMapCache,
  discoverSourceMap,
  prefetchRemoteSourceMaps,
} from '../src/analysis/sourcemap/discovery.js';
import { createSourceMapResolver } from '../src/analysis/sourcemap/resolver.js';

const MAP_URL = 'https://cdn.example.com/app.js.map';
const RAW_MAP = JSON.stringify({
  version: 3,
  file: 'app.js',
  sources: ['app.ts'],
  sourcesContent: ['const x = 1;\n'],
  names: [],
  mappings: 'AAAA',
});

let dir: string;
let genPath: string;

beforeEach(() => {
  clearRemoteSourceMapCache();
  dir = mkdtempSync(join(tmpdir(), 'lant-sm-'));
  genPath = join(dir, 'app.js');
  writeFileSync(genPath, `const x = 1;\n//# sourceMappingURL=${MAP_URL}\n`);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  clearRemoteSourceMapCache();
});

describe('remote source maps', () => {
  it('reports unsupported-mapping-url for a remote map when not pre-fetched', () => {
    const result = discoverSourceMap(genPath);
    expect(result.map).toBeUndefined();
    expect(result.failure?.reason).toBe('unsupported-mapping-url');
    expect(result.failure?.detail).toBe(MAP_URL);
  });

  it('resolves a remote map after prefetch populates the cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(RAW_MAP, { status: 200 }));
    await prefetchRemoteSourceMaps([genPath]);
    const result = discoverSourceMap(genPath);
    expect(result.failure).toBeUndefined();
    expect(result.map?.raw).toMatchObject({ version: 3 });
  });

  it('silently skips failed remote fetches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    await prefetchRemoteSourceMaps([genPath]);
    expect(discoverSourceMap(genPath).failure?.reason).toBe('unsupported-mapping-url');
  });

  it('only fetches when the resolver was created with allowRemote', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(RAW_MAP, { status: 200 }));

    const disabled = createSourceMapResolver({ cwd: dir, allowRemote: false });
    await disabled.prefetchRemote([genPath]);
    expect(fetchSpy).not.toHaveBeenCalled();
    disabled.prepare([genPath]);
    expect(disabled.integrity().mapsLoaded).toBe(0);

    clearRemoteSourceMapCache();
    const enabled = createSourceMapResolver({ cwd: dir, allowRemote: true });
    await enabled.prefetchRemote([genPath]);
    expect(fetchSpy).toHaveBeenCalledWith(MAP_URL, expect.anything());
    enabled.prepare([genPath]);
    expect(enabled.integrity().mapsLoaded).toBe(1);
  });
});
