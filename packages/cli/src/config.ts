import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { OutputFormat } from './parse.js';

const CONFIG_FILENAMES = ['.lanterna.json', '.lanterna.config.json'] as const;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

const RawConfigSchema = z.object({
  duration: z.union([z.string(), z.number()]).optional(),
  output: z.string().optional(),
  format: z.enum(['json', 'text', 'markdown']).optional(),
  pretty: z.boolean().optional(),
  detectors: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
  sampleInterval: z.number().optional(),
  heapSampleInterval: z.union([z.string(), z.number()]).optional(),
  memoryUsageInterval: z.number().optional(),
  includeMemorySamples: z.boolean().optional(),
  heapSnapshotAnalysis: z.boolean().optional(),
  heapSnapshotDir: z.string().optional(),
  waitForUrl: z.string().optional(),
  waitTimeout: z.union([z.string(), z.number()]).optional(),
  captureDelay: z.union([z.string(), z.number()]).optional(),
  workload: z.string().optional(),
});

export interface LanternaConfig {
  durationMs?: number;
  output?: string;
  format?: OutputFormat;
  pretty?: boolean;
  detectors?: string[];
  kinds?: string[];
  sampleIntervalMicros?: number;
  heapSamplingIntervalBytes?: number;
  memoryUsageIntervalMs?: number;
  includeMemoryUsageSamples?: boolean;
  heapSnapshotAnalysis?: {
    enabled: boolean;
    outputDir?: string;
  };
  waitForUrl?: string;
  waitTimeoutMs?: number;
  captureDelayMs?: number;
  workload?: string;
}

export async function loadLanternaConfig(cwd: string): Promise<LanternaConfig | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);
    let raw: string;
    try {
      raw = await readFile(filepath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${filename}: ${message}`);
    }

    const result = RawConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid ${filename}: ${result.error.message}`);
    }
    return normalizeConfig(result.data);
  }
  return undefined;
}

export function applyLanternaConfig<TOptions extends ConfigurableOptions>(
  config: LanternaConfig | undefined,
  options: TOptions,
  providedFlags: ReadonlySet<string>,
): TOptions {
  if (!config) return options;
  const merged = {
    ...options,
    ...mergeField(config, options, providedFlags, 'durationMs'),
    ...mergeField(config, options, providedFlags, 'output'),
    ...mergeField(config, options, providedFlags, 'format'),
    ...mergeField(config, options, providedFlags, 'pretty'),
    ...mergeField(config, options, providedFlags, 'sampleIntervalMicros'),
    ...mergeField(config, options, providedFlags, 'heapSamplingIntervalBytes'),
    ...mergeField(config, options, providedFlags, 'memoryUsageIntervalMs'),
    ...mergeField(config, options, providedFlags, 'includeMemoryUsageSamples'),
    ...mergeField(config, options, providedFlags, 'heapSnapshotAnalysis'),
    ...mergeField(config, options, providedFlags, 'waitForUrl'),
    ...mergeField(config, options, providedFlags, 'waitTimeoutMs'),
    ...mergeField(config, options, providedFlags, 'captureDelayMs'),
    ...mergeField(config, options, providedFlags, 'workload'),
    detectors: [...(config.detectors ?? []), ...(options.detectors ?? [])],
    kinds: providedFlags.has('kind')
      ? dedupe([...(config.kinds ?? []), ...(options.kinds ?? [])])
      : dedupe(config.kinds ?? options.kinds ?? []),
  };
  if (
    merged.heapSnapshotAnalysis &&
    (merged.heapSnapshotAnalysis.enabled || merged.heapSnapshotAnalysis.outputDir) &&
    !merged.kinds.includes('memory')
  ) {
    throw new Error('heap snapshot analysis in Lanterna config requires kind "memory"');
  }
  return merged;
}

interface ConfigurableOptions {
  detectors?: string[];
  kinds?: string[];
  [key: string]: unknown;
}

function mergeField<TOptions extends ConfigurableOptions, TKey extends keyof LanternaConfig>(
  config: LanternaConfig,
  options: TOptions,
  providedFlags: ReadonlySet<string>,
  key: TKey,
): Partial<Record<TKey, LanternaConfig[TKey]>> {
  if (providedFlags.has(String(key)))
    return { [key]: options[key as string] } as Partial<Record<TKey, LanternaConfig[TKey]>>;
  if (config[key] !== undefined)
    return { [key]: config[key] } as Partial<Record<TKey, LanternaConfig[TKey]>>;
  return {};
}

function normalizeConfig(raw: z.infer<typeof RawConfigSchema>): LanternaConfig {
  const config: LanternaConfig = {
    ...(raw.duration !== undefined
      ? { durationMs: parseDurationConfig(raw.duration, 'duration') }
      : {}),
    ...(raw.output !== undefined ? { output: raw.output } : {}),
    ...(raw.format !== undefined ? { format: raw.format } : {}),
    ...(raw.pretty !== undefined ? { pretty: raw.pretty } : {}),
    ...(raw.detectors !== undefined ? { detectors: raw.detectors } : {}),
    ...(raw.kinds !== undefined ? { kinds: dedupe(expandKinds(raw.kinds)) } : {}),
    ...(raw.sampleInterval !== undefined ? { sampleIntervalMicros: raw.sampleInterval } : {}),
    ...(raw.heapSampleInterval !== undefined
      ? { heapSamplingIntervalBytes: parseHeapSampleIntervalConfig(raw.heapSampleInterval) }
      : {}),
    ...(raw.memoryUsageInterval !== undefined
      ? { memoryUsageIntervalMs: raw.memoryUsageInterval }
      : {}),
    ...(raw.includeMemorySamples !== undefined
      ? { includeMemoryUsageSamples: raw.includeMemorySamples }
      : {}),
    ...(raw.heapSnapshotAnalysis !== undefined || raw.heapSnapshotDir !== undefined
      ? {
          heapSnapshotAnalysis: {
            enabled: Boolean(raw.heapSnapshotAnalysis),
            ...(raw.heapSnapshotDir ? { outputDir: raw.heapSnapshotDir } : {}),
          },
        }
      : {}),
    ...(raw.waitForUrl !== undefined ? { waitForUrl: raw.waitForUrl } : {}),
    ...(raw.waitForUrl !== undefined || raw.waitTimeout !== undefined
      ? {
          waitTimeoutMs:
            raw.waitTimeout !== undefined
              ? parseDurationConfig(raw.waitTimeout, 'waitTimeout')
              : DEFAULT_WAIT_TIMEOUT_MS,
        }
      : {}),
    ...(raw.captureDelay !== undefined
      ? { captureDelayMs: parseDurationConfig(raw.captureDelay, 'captureDelay') }
      : {}),
    ...(raw.workload !== undefined ? { workload: raw.workload } : {}),
  };
  return config;
}

function parseDurationConfig(value: string | number, field: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${field}: ${value}`);
    return value;
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(value);
  if (!match) throw new Error(`Invalid ${field}: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  return amount;
}

function parseHeapSampleIntervalConfig(value: string | number): number {
  const raw = String(value).trim();
  const match = /^(\d+(?:\.\d+)?)\s*(b|kib|kb|k|mib|mb|m)?$/i.exec(raw);
  if (!match) throw new Error(`Invalid heapSampleInterval: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  let bytes: number;
  if (unit === 'mib' || unit === 'mb' || unit === 'm') bytes = amount * 1024 * 1024;
  else if (unit === 'kib' || unit === 'kb' || unit === 'k') bytes = amount * 1024;
  else bytes = amount;
  return Math.round(bytes);
}

function expandKinds(values: string[]): string[] {
  return values.flatMap((value) =>
    value
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean),
  );
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
