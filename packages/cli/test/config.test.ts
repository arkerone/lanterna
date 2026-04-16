import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLanternaConfig } from '../src/config.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lanterna-cfg-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('loadLanternaConfig', () => {
  it('returns undefined when no config file exists', async () => {
    await withTempDir(async (dir) => {
      expect(await loadLanternaConfig(dir)).toBeUndefined();
    });
  });

  it('loads .lanterna.json when present', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, '.lanterna.json'),
        JSON.stringify({ detectors: ['@scope/plugin', './local.js'] }),
      );
      const config = await loadLanternaConfig(dir);
      expect(config).toEqual({ detectors: ['@scope/plugin', './local.js'] });
    });
  });

  it('falls back to .lanterna.config.json', async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, '.lanterna.config.json'),
        JSON.stringify({ detectors: ['only-there'] }),
      );
      const config = await loadLanternaConfig(dir);
      expect(config?.detectors).toEqual(['only-there']);
    });
  });

  it('throws on malformed JSON', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.lanterna.json'), '{not json');
      await expect(loadLanternaConfig(dir)).rejects.toThrow(/Failed to parse .lanterna.json/);
    });
  });

  it('throws on invalid schema', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.lanterna.json'), JSON.stringify({ detectors: [1, 2, 3] }));
      await expect(loadLanternaConfig(dir)).rejects.toThrow(/Invalid .lanterna.json/);
    });
  });
});
