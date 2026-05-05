import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  normalizeKinds,
  type OutputFormat,
  parseDurationMs,
  parseHeapSamplingIntervalBytes,
  parseMemoryUsageIntervalMs,
  parseSampleIntervalMicros,
} from './options-normalization.js';

const CONFIG_FILENAMES = ['.lanterna.json', '.lanterna.config.json'] as const;
const SCALAR_CONFIG_KEYS = [
  'durationMs',
  'output',
  'format',
  'pretty',
  'sourceMaps',
  'sampleIntervalMicros',
  'heapSamplingIntervalBytes',
  'memoryUsageIntervalMs',
  'includeMemoryUsageSamples',
  'heapSnapshotAnalysis',
  'waitForUrl',
  'waitTimeoutMs',
  'captureDelayMs',
  'workload',
  'asyncMaxRecords',
  'asyncStackDepth',
  'asyncIncludeMicrotasks',
  'asyncConcurrencyIntervalMs',
  'asyncInstrumentation',
] as const;

type ScalarConfigKey = (typeof SCALAR_CONFIG_KEYS)[number];

const RawConfigSchema = z.object({
  duration: z.union([z.string(), z.number()]).optional(),
  output: z.string().optional(),
  format: z.enum(['json', 'text', 'markdown']).optional(),
  pretty: z.boolean().optional(),
  sourceMaps: z.boolean().optional(),
  detectors: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
  sampleInterval: z.union([z.string(), z.number()]).optional(),
  heapSampleInterval: z.union([z.string(), z.number()]).optional(),
  memoryUsageInterval: z.union([z.string(), z.number()]).optional(),
  includeMemorySamples: z.boolean().optional(),
  heapSnapshotAnalysis: z.boolean().optional(),
  heapSnapshotDir: z.string().optional(),
  asyncMaxEvents: z.number().optional(),
  asyncStackDepth: z.number().optional(),
  asyncIncludeMicrotasks: z.boolean().optional(),
  asyncConcurrencyInterval: z.union([z.string(), z.number()]).optional(),
  asyncInstrumentation: z.enum(['off', 'safe', 'full']).optional(),
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
  sourceMaps?: boolean;
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
  asyncMaxRecords?: number;
  asyncStackDepth?: number;
  asyncIncludeMicrotasks?: boolean;
  asyncConcurrencyIntervalMs?: number;
  asyncInstrumentation?: 'off' | 'safe' | 'full';
  waitForUrl?: string;
  waitTimeoutMs?: number;
  captureDelayMs?: number;
  workload?: string;
}

export async function loadLanternaConfig(cwd: string): Promise<LanternaConfig | undefined> {
  const configFile = await readLanternaConfigFile(cwd);
  if (!configFile) return undefined;

  const parsed = parseConfigJson(configFile);
  const rawConfig = validateConfig(configFile.filename, parsed);
  return normalizeConfig(rawConfig);
}

export function applyLanternaConfig<TOptions extends ConfigurableOptions>(
  config: LanternaConfig | undefined,
  options: TOptions,
  providedFlags: ReadonlySet<string>,
): TOptions {
  if (!config) return options;
  return new ConfigMerger(config, options, providedFlags).merge();
}

interface ConfigFile {
  filename: string;
  raw: string;
}

async function readLanternaConfigFile(cwd: string): Promise<ConfigFile | undefined> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(cwd, filename);
    try {
      return { filename, raw: await readFile(filepath, 'utf8') };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  return undefined;
}

function parseConfigJson(configFile: ConfigFile): unknown {
  try {
    return JSON.parse(configFile.raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${configFile.filename}: ${message}`);
  }
}

function validateConfig(filename: string, parsed: unknown): z.infer<typeof RawConfigSchema> {
  const result = RawConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid ${filename}: ${result.error.message}`);
  }
  return result.data;
}

interface ConfigurableOptions extends Partial<LanternaConfig> {
  [key: string]: unknown;
}

class ConfigMerger<TOptions extends ConfigurableOptions> {
  private readonly merged: ConfigurableOptions;

  constructor(
    private readonly config: LanternaConfig,
    private readonly options: TOptions,
    private readonly providedFlags: ReadonlySet<string>,
  ) {
    this.merged = { ...options };
  }

  merge(): TOptions {
    this.applyScalarConfigValues();
    this.mergeDetectors();
    this.mergeKinds();
    this.assertHeapSnapshotKind();
    return this.merged as TOptions;
  }

  private applyScalarConfigValues(): void {
    for (const key of SCALAR_CONFIG_KEYS) {
      this.applyScalarConfigValue(key);
    }
  }

  private applyScalarConfigValue(key: ScalarConfigKey): void {
    if (this.providedFlags.has(key)) return;

    const value = this.config[key];
    if (value !== undefined) this.assign(key, value);
  }

  private mergeDetectors(): void {
    this.merged.detectors = [...(this.config.detectors ?? []), ...(this.options.detectors ?? [])];
  }

  private mergeKinds(): void {
    if (this.providedFlags.has('kind')) {
      this.merged.kinds = dedupe([...(this.config.kinds ?? []), ...(this.options.kinds ?? [])]);
      return;
    }
    this.merged.kinds = dedupe(this.config.kinds ?? this.options.kinds ?? []);
  }

  private assertHeapSnapshotKind(): void {
    const heapSnapshot = this.merged.heapSnapshotAnalysis;
    if (!heapSnapshot?.enabled && !heapSnapshot?.outputDir) return;
    if (this.merged.kinds?.includes('memory')) return;
    throw new Error('heap snapshot analysis in Lanterna config requires kind "memory"');
  }

  private assign(key: ScalarConfigKey, value: LanternaConfig[ScalarConfigKey]): void {
    const mutableMerged = this.merged as Record<string, unknown>;
    mutableMerged[key] = value;
  }
}

function normalizeConfig(raw: z.infer<typeof RawConfigSchema>): LanternaConfig {
  const config: LanternaConfig = {};
  if (raw.duration !== undefined) config.durationMs = parseDurationMs(raw.duration, 'duration');
  if (raw.output !== undefined) config.output = raw.output;
  if (raw.format !== undefined) config.format = raw.format;
  if (raw.pretty !== undefined) config.pretty = raw.pretty;
  if (raw.sourceMaps !== undefined) config.sourceMaps = raw.sourceMaps;
  if (raw.detectors !== undefined) config.detectors = raw.detectors;
  if (raw.kinds !== undefined) config.kinds = normalizeKinds(raw.kinds);
  if (raw.sampleInterval !== undefined) {
    config.sampleIntervalMicros = parseSampleIntervalMicros(raw.sampleInterval, 'sampleInterval');
  }
  if (raw.heapSampleInterval !== undefined) {
    config.heapSamplingIntervalBytes = parseHeapSamplingIntervalBytes(
      raw.heapSampleInterval,
      'heapSampleInterval',
    );
  }
  if (raw.memoryUsageInterval !== undefined) {
    config.memoryUsageIntervalMs = parseMemoryUsageIntervalMs(
      raw.memoryUsageInterval,
      'memoryUsageInterval',
    );
  }
  if (raw.includeMemorySamples !== undefined) {
    config.includeMemoryUsageSamples = raw.includeMemorySamples;
  }
  if (raw.heapSnapshotAnalysis !== undefined || raw.heapSnapshotDir !== undefined) {
    config.heapSnapshotAnalysis = {
      enabled: Boolean(raw.heapSnapshotAnalysis),
    };
    if (raw.heapSnapshotDir) config.heapSnapshotAnalysis.outputDir = raw.heapSnapshotDir;
  }
  if (raw.asyncMaxEvents !== undefined) config.asyncMaxRecords = raw.asyncMaxEvents;
  if (raw.asyncStackDepth !== undefined) config.asyncStackDepth = raw.asyncStackDepth;
  if (raw.asyncIncludeMicrotasks !== undefined) {
    config.asyncIncludeMicrotasks = raw.asyncIncludeMicrotasks;
  }
  if (raw.asyncConcurrencyInterval !== undefined) {
    config.asyncConcurrencyIntervalMs = parseDurationMs(
      raw.asyncConcurrencyInterval,
      'asyncConcurrencyInterval',
    );
  }
  if (raw.asyncInstrumentation !== undefined) {
    config.asyncInstrumentation = raw.asyncInstrumentation;
  }
  if (raw.waitForUrl !== undefined) config.waitForUrl = raw.waitForUrl;
  if (raw.waitTimeout !== undefined) {
    config.waitTimeoutMs = parseDurationMs(raw.waitTimeout, 'waitTimeout');
  } else if (raw.waitForUrl !== undefined) {
    config.waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS;
  }
  if (raw.captureDelay !== undefined) {
    config.captureDelayMs = parseDurationMs(raw.captureDelay, 'captureDelay');
  }
  if (raw.workload !== undefined) config.workload = raw.workload;
  return config;
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
