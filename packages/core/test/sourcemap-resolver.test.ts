import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createNoopSourceMapResolver,
  createSourceMapResolver,
} from '../src/analysis/sourcemap/resolver.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lanterna-sm-resolver-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface FixtureOptions {
  /** Sources written into the .map. Defaults to relative TS path. */
  sources?: string[];
  /** Names array. Defaults to ["myFn", "bar"]. */
  names?: string[];
  /** Encoded VLQ mappings string. Defaults to two-line fixture. */
  mappings?: string;
}

/**
 * Writes a `dist/foo.js` + `dist/foo.js.map` pair under the temp dir.
 * Default mappings encode:
 *   gen line 1 col 0 → source 0 line 5 col 2 name 0 ("myFn")  → "AAIEA"
 *   gen line 2 col 0 → source 0 line 9 col 2 name 1 ("bar")   → "AAIAC"
 */
function writeFixture(opts: FixtureOptions = {}): { jsUrl: string; jsPath: string } {
  const distDir = join(dir, 'dist');
  mkdirSync(distDir, { recursive: true });
  const jsPath = join(distDir, 'foo.js');
  writeFileSync(
    jsPath,
    'function myFn(){return 1;}\nfunction bar(){return 2;}\n//# sourceMappingURL=foo.js.map\n',
  );
  const map = {
    version: 3,
    file: 'foo.js',
    sources: opts.sources ?? ['../src/foo.ts'],
    names: opts.names ?? ['myFn', 'bar'],
    mappings: opts.mappings ?? 'AAIEA;AAIAC',
  };
  writeFileSync(`${jsPath}.map`, JSON.stringify(map));
  return { jsPath, jsUrl: pathToFileURL(jsPath).href };
}

describe('createSourceMapResolver', () => {
  it('resolves a generated position back to the original source (relative to cwd)', () => {
    const { jsUrl } = writeFixture();
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl]);

    // Lanterna stores 1-based line + 1-based column; resolver converts to 0-based col internally.
    const loc = resolver.resolve(jsUrl, 1, 1);
    expect(loc).toEqual({
      file: 'src/foo.ts',
      line: 5,
      column: 3, // trace-mapping returns 0-based col 2; resolver re-bumps to 1-based.
      name: 'myFn',
    });
  });

  it('resolves a second generated line with a different name', () => {
    const { jsUrl } = writeFixture();
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl]);
    const loc = resolver.resolve(jsUrl, 2, 1);
    expect(loc?.name).toBe('bar');
    expect(loc?.line).toBe(9);
  });

  it('keeps virtual bundler source paths (webpack://) verbatim', () => {
    const { jsUrl } = writeFixture({ sources: ['webpack://app/./src/foo.ts'] });
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl]);
    const loc = resolver.resolve(jsUrl, 1, 1);
    expect(loc?.file).toBe('webpack://app/src/foo.ts');
  });

  it('keeps Vite virtual source paths (vite:/) verbatim', () => {
    const { jsUrl } = writeFixture({ sources: ['vite:/src/foo.ts'] });
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl]);
    const loc = resolver.resolve(jsUrl, 1, 1);
    expect(loc?.file).toBe('vite:/src/foo.ts');
  });

  it('falls back to absolute source path when the file is outside cwd', () => {
    const { jsUrl } = writeFixture({ sources: ['/somewhere/else/src/foo.ts'] });
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl]);
    const loc = resolver.resolve(jsUrl, 1, 1);
    expect(loc?.file).toBe('/somewhere/else/src/foo.ts');
  });

  it('does not count plain JS without sourceMappingURL against coverage', () => {
    const plainJs = join(dir, 'plain.js');
    writeFileSync(plainJs, 'console.log(1);\n');
    const resolver = createSourceMapResolver({ cwd: dir });
    const plainUrl = pathToFileURL(plainJs).href;
    resolver.prepare([plainUrl]);

    const loc = resolver.resolve(plainUrl, 1, 1);

    expect(loc).toBeUndefined();
    expect(resolver.integrity()).toMatchObject({
      applicable: false,
      status: 'not-applicable',
      framesResolved: 0,
      framesUnresolved: 0,
      coverage: 1,
      mapsLoaded: 0,
      failures: [],
    });
  });

  it('counts missing referenced source maps as failed coverage', () => {
    const missingMapJs = join(dir, 'missing-map.js');
    writeFileSync(missingMapJs, 'console.log(1);\n//# sourceMappingURL=missing-map.js.map\n');
    const resolver = createSourceMapResolver({ cwd: dir });
    const missingMapUrl = pathToFileURL(missingMapJs).href;
    resolver.prepare([missingMapUrl]);

    const loc = resolver.resolve(missingMapUrl, 1, 1);

    expect(loc).toBeUndefined();
    expect(resolver.integrity()).toMatchObject({
      applicable: true,
      status: 'failed',
      framesResolved: 0,
      framesUnresolved: 1,
      coverage: 0,
      mapsLoaded: 0,
    });
    expect(resolver.integrity().failures[0]?.reason).toContain('map-read-failed');
  });

  it('reports coverage from resolved/unresolved counters', () => {
    const { jsUrl } = writeFixture();
    const missingMapJs = join(dir, 'missing-map.js');
    writeFileSync(missingMapJs, 'console.log(1);\n//# sourceMappingURL=missing-map.js.map\n');
    const missingMapUrl = pathToFileURL(missingMapJs).href;
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl, missingMapUrl]);
    resolver.resolve(jsUrl, 1, 1); // resolved
    resolver.resolve(jsUrl, 1, 1); // resolved
    resolver.resolve(missingMapUrl, 1, 1); // unresolved
    const integrity = resolver.integrity();
    expect(integrity.applicable).toBe(true);
    expect(integrity.status).toBe('partial');
    expect(integrity.framesResolved).toBe(2);
    expect(integrity.framesUnresolved).toBe(1);
    expect(integrity.coverage).toBeCloseTo(2 / 3, 5);
    expect(integrity.mapsLoaded).toBe(1);
  });

  it('caps recorded failures at 20', () => {
    const resolver = createSourceMapResolver({ cwd: dir });
    const urls: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const p = join(dir, `f${i}.js`);
      writeFileSync(p, `console.log(${i});\n//# sourceMappingURL=missing.map\n`);
      urls.push(pathToFileURL(p).href);
    }
    resolver.prepare(urls);
    const integrity = resolver.integrity();
    expect(integrity.failures.length).toBe(20);
    expect(integrity.failures.every((f) => f.reason.startsWith('map-read-failed'))).toBe(true);
  });

  it('does nothing when disabled', () => {
    const { jsUrl } = writeFixture();
    const resolver = createSourceMapResolver({ cwd: dir, enabled: false });
    resolver.prepare([jsUrl]);
    expect(resolver.resolve(jsUrl, 1, 1)).toBeUndefined();
    const integrity = resolver.integrity();
    expect(integrity.enabled).toBe(false);
    expect(integrity.mapsLoaded).toBe(0);
    expect(integrity.framesResolved).toBe(0);
    expect(integrity.framesUnresolved).toBe(0);
  });

  it('skips uninteresting failure reasons (no-mapping-url, not-file-url)', () => {
    const plainJs = join(dir, 'plain.js');
    writeFileSync(plainJs, 'console.log(1);\n');
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([pathToFileURL(plainJs).href, 'node:internal/foo']);
    expect(resolver.integrity().failures).toEqual([]);
  });

  it('does not count node: builtin URLs against coverage', () => {
    const { jsUrl } = writeFixture();
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([jsUrl]);
    resolver.resolve(jsUrl, 1, 1); // resolved
    resolver.resolve('node:internal/process/task_queues', 10, 1); // ignored
    resolver.resolve('', 1, 1); // ignored
    const integrity = resolver.integrity();
    expect(integrity.framesResolved).toBe(1);
    expect(integrity.framesUnresolved).toBe(0);
    expect(integrity.coverage).toBe(1);
  });

  it('skips lanterna-preload .cjs urls (they are deleted before analysis)', () => {
    const preloadUrl = 'file:///tmp/lanterna-preload-12345-abc.cjs';
    const resolver = createSourceMapResolver({ cwd: dir });
    resolver.prepare([preloadUrl]);
    expect(resolver.integrity().failures).toEqual([]);
  });
});

describe('createNoopSourceMapResolver', () => {
  it('always returns undefined and reports disabled integrity', () => {
    const resolver = createNoopSourceMapResolver();
    resolver.prepare(['file:///foo.js']);
    expect(resolver.resolve('file:///foo.js', 1, 1)).toBeUndefined();
    expect(resolver.integrity()).toEqual({
      enabled: false,
      framesResolved: 0,
      framesUnresolved: 0,
      coverage: 0,
      mapsLoaded: 0,
      failures: [],
    });
  });
});
