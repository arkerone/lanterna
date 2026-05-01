import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLanternaConfig } from '../src/config.js';
import { parseRunArgs } from '../src/parse.js';

async function withConfig<T>(config: unknown, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lanterna-options-'));
  try {
    await writeFile(join(dir, '.lanterna.json'), JSON.stringify(config));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('CLI/config option normalization parity', () => {
  it.each([
    ['500ms', 500],
    ['1.5s', 1500],
    ['2m', 120_000],
    [250, 250],
  ])('normalizes duration %s consistently', async (value, expected) => {
    await withConfig({ duration: value }, async (dir) => {
      expect((await loadLanternaConfig(dir))?.durationMs).toBe(expected);
    });

    expect(parseRunArgs(['--duration', String(value), '--', 'node', 'app.js']).durationMs).toBe(
      expected,
    );
  });

  it.each([
    'big',
    '512',
  ])('rejects invalid heap sample intervals in config and CLI', async (value) => {
    await withConfig({ heapSampleInterval: value }, async (dir) => {
      await expect(loadLanternaConfig(dir)).rejects.toThrow(/heapSampleInterval/);
    });

    expect(() => parseRunArgs(['--heap-sample-interval', value, '--', 'node', 'app.js'])).toThrow(
      /heap-sample-interval/,
    );
  });

  it.each([5, '5'])('rejects memory usage intervals below the CLI minimum', async (value) => {
    await withConfig({ memoryUsageInterval: value }, async (dir) => {
      await expect(loadLanternaConfig(dir)).rejects.toThrow(/memoryUsageInterval/);
    });

    expect(() =>
      parseRunArgs(['--memory-usage-interval', String(value), '--', 'node', 'app.js']),
    ).toThrow(/memory-usage-interval/);
  });

  it('rejects sample intervals below the CLI minimum in config', async () => {
    await withConfig({ sampleInterval: 10 }, async (dir) => {
      await expect(loadLanternaConfig(dir)).rejects.toThrow(/sampleInterval/);
    });
  });

  it('normalizes comma-separated config kinds like repeated CLI kinds', async () => {
    await withConfig({ kinds: ['cpu,memory', 'cpu', 'async'] }, async (dir) => {
      expect((await loadLanternaConfig(dir))?.kinds).toEqual(['cpu', 'memory', 'async']);
    });

    expect(
      parseRunArgs([
        '--kind',
        'cpu,memory',
        '--kind',
        'cpu',
        '--kind',
        'async',
        '--',
        'node',
        'app.js',
      ]).kinds,
    ).toEqual(['cpu', 'memory', 'async']);
  });
});
