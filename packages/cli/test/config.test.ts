import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLanternaConfig, loadLanternaConfig } from '../src/config.js';

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
        JSON.stringify({
          duration: '15s',
          output: 'report.md',
          format: 'markdown',
          pretty: true,
          sourceMaps: false,
          detectors: ['@scope/plugin', './local.js'],
          kinds: ['cpu', 'memory'],
          sampleInterval: 2000,
          heapSampleInterval: '1MiB',
          memoryUsageInterval: 500,
          includeMemorySamples: true,
          heapSnapshotAnalysis: true,
          heapSnapshotDir: '.lanterna-heaps',
          waitForUrl: 'http://127.0.0.1:3000/health',
          waitTimeout: '10s',
          captureDelay: '250ms',
          workload: 'npx -y autocannon http://127.0.0.1:3000',
          asyncMaxEvents: 100,
          asyncStackDepth: 16,
          asyncIncludeMicrotasks: true,
          asyncConcurrencyInterval: '50ms',
          asyncInstrumentation: 'full',
        }),
      );
      const config = await loadLanternaConfig(dir);
      expect(config).toEqual({
        durationMs: 15_000,
        output: 'report.md',
        format: 'markdown',
        pretty: true,
        sourceMaps: false,
        detectors: ['@scope/plugin', './local.js'],
        kinds: ['cpu', 'memory'],
        sampleIntervalMicros: 2000,
        heapSamplingIntervalBytes: 1024 * 1024,
        memoryUsageIntervalMs: 500,
        includeMemoryUsageSamples: true,
        heapSnapshotAnalysis: { enabled: true, outputDir: '.lanterna-heaps' },
        waitForUrl: 'http://127.0.0.1:3000/health',
        waitTimeoutMs: 10_000,
        captureDelayMs: 250,
        workload: 'npx -y autocannon http://127.0.0.1:3000',
        asyncMaxRecords: 100,
        asyncStackDepth: 16,
        asyncIncludeMicrotasks: true,
        asyncConcurrencyIntervalMs: 50,
        asyncInstrumentation: 'full',
      });
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

  it('merges config first and lets explicit flags win', () => {
    const parsed = applyLanternaConfig(
      {
        durationMs: 10_000,
        format: 'text',
        pretty: true,
        detectors: ['config-detector'],
        kinds: ['memory'],
        sampleIntervalMicros: 2000,
        heapSamplingIntervalBytes: 1024 * 1024,
        memoryUsageIntervalMs: 500,
        includeMemoryUsageSamples: true,
        heapSnapshotAnalysis: { enabled: true, outputDir: 'heaps' },
        waitForUrl: 'http://127.0.0.1:3000/ready',
        waitTimeoutMs: 10_000,
        captureDelayMs: 250,
        workload: 'npm run load',
        sourceMaps: false,
      },
      {
        command: ['node', 'app.js'],
        pretty: false,
        format: 'markdown',
        detectors: ['flag-detector'],
        kinds: ['cpu', 'memory'],
        sampleIntervalMicros: 1000,
        heapSamplingIntervalBytes: 524_288,
        memoryUsageIntervalMs: 250,
        includeMemoryUsageSamples: false,
        heapSnapshotAnalysis: { enabled: false },
        deep: false,
      },
      new Set(['format', 'detectors', 'kind']),
    );

    expect(parsed).toMatchObject({
      command: ['node', 'app.js'],
      durationMs: 10_000,
      format: 'markdown',
      pretty: true,
      detectors: ['config-detector', 'flag-detector'],
      kinds: ['memory', 'cpu'],
      sampleIntervalMicros: 2000,
      heapSamplingIntervalBytes: 1024 * 1024,
      memoryUsageIntervalMs: 500,
      includeMemoryUsageSamples: true,
      heapSnapshotAnalysis: { enabled: true, outputDir: 'heaps' },
      waitForUrl: 'http://127.0.0.1:3000/ready',
      waitTimeoutMs: 10_000,
      captureDelayMs: 250,
      workload: 'npm run load',
      sourceMaps: false,
    });
  });

  it('lets an explicit CLI source maps setting win over config', () => {
    const parsed = applyLanternaConfig(
      {
        sourceMaps: false,
      },
      {
        command: ['node', 'app.js'],
        pretty: false,
        format: 'json',
        detectors: [],
        kinds: ['cpu'],
        sampleIntervalMicros: 1000,
        heapSamplingIntervalBytes: 524_288,
        memoryUsageIntervalMs: 250,
        includeMemoryUsageSamples: false,
        heapSnapshotAnalysis: { enabled: false },
        sourceMaps: true,
        deep: false,
      },
      new Set(['sourceMaps']),
    );

    expect(parsed.sourceMaps).toBe(true);
  });

  it('uses config kinds instead of the parser default when no kind flag was provided', () => {
    const parsed = applyLanternaConfig(
      {
        kinds: ['memory', 'memory'],
      },
      {
        command: ['node', 'app.js'],
        pretty: false,
        format: 'json',
        detectors: [],
        kinds: ['cpu'],
        sampleIntervalMicros: 1000,
        heapSamplingIntervalBytes: 524_288,
        memoryUsageIntervalMs: 250,
        includeMemoryUsageSamples: false,
        heapSnapshotAnalysis: { enabled: false },
        deep: false,
      },
      new Set(),
    );

    expect(parsed.kinds).toEqual(['memory']);
  });
});
