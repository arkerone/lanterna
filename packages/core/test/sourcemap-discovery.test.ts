import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSourceMap } from '../src/analysis/sourcemap/discovery.js';

const SAMPLE_MAP = {
  version: 3,
  file: 'foo.js',
  sources: ['../src/foo.ts'],
  names: ['myFn'],
  mappings: 'AAIEA',
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lanterna-sm-discovery-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJs(name: string, body: string, mappingUrl: string | null): string {
  const path = join(dir, name);
  const tail = mappingUrl === null ? '' : `\n//# sourceMappingURL=${mappingUrl}\n`;
  writeFileSync(path, `${body}${tail}`);
  return path;
}

describe('discoverSourceMap', () => {
  it('loads a sibling .map file', () => {
    const jsPath = writeJs('foo.js', 'console.log(1);', 'foo.js.map');
    writeFileSync(`${jsPath}.map`, JSON.stringify(SAMPLE_MAP));

    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure).toBeUndefined();
    expect(result.map?.generatedPath).toBe(jsPath);
    expect((result.map?.raw as { sources: string[] }).sources).toEqual(['../src/foo.ts']);
  });

  it('decodes a base64 inline data URL', () => {
    const payload = Buffer.from(JSON.stringify(SAMPLE_MAP)).toString('base64');
    const jsPath = writeJs('foo.js', 'console.log(1);', `data:application/json;base64,${payload}`);
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure).toBeUndefined();
    expect((result.map?.raw as { mappings: string }).mappings).toBe('AAIEA');
  });

  it('decodes a uri-encoded inline data URL', () => {
    const payload = encodeURIComponent(JSON.stringify(SAMPLE_MAP));
    const jsPath = writeJs('foo.js', 'console.log(1);', `data:application/json,${payload}`);
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure).toBeUndefined();
    expect((result.map?.raw as { sources: string[] }).sources).toEqual(['../src/foo.ts']);
  });

  it('reports map-read-failed when the .map sibling is missing', () => {
    const jsPath = writeJs('foo.js', 'console.log(1);', 'foo.js.map');
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.map).toBeUndefined();
    expect(result.failure?.reason).toBe('map-read-failed');
  });

  it('reports no-mapping-url when the file has no sourceMappingURL comment', () => {
    const jsPath = writeJs('foo.js', 'console.log(1);', null);
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure?.reason).toBe('no-mapping-url');
  });

  it('reports not-file-url for non-file URLs', () => {
    const result = discoverSourceMap('node:internal/foo');
    expect(result.failure?.reason).toBe('not-file-url');
  });

  it('reports unsupported-mapping-url for remote schemes', () => {
    const jsPath = writeJs('foo.js', 'console.log(1);', 'https://example.com/foo.js.map');
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure?.reason).toBe('unsupported-mapping-url');
  });

  it('reports map-parse-failed for an invalid JSON map', () => {
    const jsPath = writeJs('foo.js', 'console.log(1);', 'foo.js.map');
    writeFileSync(`${jsPath}.map`, '{not json');
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure?.reason).toBe('map-parse-failed');
  });

  it('finds sourceMappingURL even when the JS file is larger than the tail window', () => {
    const filler = 'a;'.repeat(20_000); // >>8 KiB
    const jsPath = writeJs('foo.js', filler, 'foo.js.map');
    writeFileSync(`${jsPath}.map`, JSON.stringify(SAMPLE_MAP));
    const result = discoverSourceMap(pathToFileURL(jsPath).href);
    expect(result.failure).toBeUndefined();
    expect(result.map).toBeDefined();
  });

  it('reports js-read-failed when the generated file does not exist', () => {
    const missing = pathToFileURL(join(dir, 'missing.js')).href;
    const result = discoverSourceMap(missing);
    expect(result.failure?.reason).toBe('js-read-failed');
  });
});
