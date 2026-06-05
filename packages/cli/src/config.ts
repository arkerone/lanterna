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
  'sourceMapRemote',
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

/**
 * One scalar `.lanterna.json` option: its raw field, the canonical
 * {@link LanternaConfig} key it lands on, the schema that validates the raw
 * value, and how to normalize raw → canonical. The single source of truth that
 * drives both {@link RawConfigSchema} and {@link normalizeConfig} so a new scalar
 * option is one row, not a schema field plus a normalize branch. Options with an
 * irregular shape (the `detectors` / `kinds` arrays, the nested
 * `heapSnapshotAnalysis`, the interdependent `waitForUrl` / `waitTimeout`) are
 * handled explicitly below rather than forced into this table.
 */
interface ScalarConfigOption {
  readonly raw: string;
  readonly key: keyof LanternaConfig & string;
  readonly schema: z.ZodTypeAny;
  readonly normalize: (raw: unknown) => unknown;
}

function scalarOption<R>(
  raw: string,
  key: keyof LanternaConfig & string,
  schema: z.ZodType<R>,
  normalize: (value: R) => unknown = (value) => value,
): ScalarConfigOption {
  return { raw, key, schema, normalize: (value) => normalize(value as R) };
}

const durationLike = () => z.union([z.string(), z.number()]);

const SCALAR_CONFIG_OPTIONS: readonly ScalarConfigOption[] = [
  scalarOption('duration', 'durationMs', durationLike(), (v) => parseDurationMs(v, 'duration')),
  scalarOption('output', 'output', z.string()),
  scalarOption('format', 'format', z.enum(['json', 'text', 'markdown', 'agent'])),
  scalarOption('pretty', 'pretty', z.boolean()),
  scalarOption('sourceMaps', 'sourceMaps', z.boolean()),
  scalarOption('sourceMapRemote', 'sourceMapRemote', z.boolean()),
  scalarOption('sampleInterval', 'sampleIntervalMicros', durationLike(), (v) =>
    parseSampleIntervalMicros(v, 'sampleInterval'),
  ),
  scalarOption('heapSampleInterval', 'heapSamplingIntervalBytes', durationLike(), (v) =>
    parseHeapSamplingIntervalBytes(v, 'heapSampleInterval'),
  ),
  scalarOption('memoryUsageInterval', 'memoryUsageIntervalMs', durationLike(), (v) =>
    parseMemoryUsageIntervalMs(v, 'memoryUsageInterval'),
  ),
  scalarOption('includeMemorySamples', 'includeMemoryUsageSamples', z.boolean()),
  scalarOption('asyncMaxEvents', 'asyncMaxRecords', z.number()),
  scalarOption('asyncStackDepth', 'asyncStackDepth', z.number()),
  scalarOption('asyncIncludeMicrotasks', 'asyncIncludeMicrotasks', z.boolean()),
  scalarOption('asyncConcurrencyInterval', 'asyncConcurrencyIntervalMs', durationLike(), (v) =>
    parseDurationMs(v, 'asyncConcurrencyInterval'),
  ),
  scalarOption('asyncInstrumentation', 'asyncInstrumentation', z.enum(['off', 'safe', 'full'])),
  scalarOption('captureDelay', 'captureDelayMs', durationLike(), (v) =>
    parseDurationMs(v, 'captureDelay'),
  ),
  scalarOption('workload', 'workload', z.string()),
];

const scalarConfigSchemaShape: z.ZodRawShape = Object.fromEntries(
  SCALAR_CONFIG_OPTIONS.map((option) => [option.raw, option.schema.optional()]),
);

/** Options whose shape is irregular enough to stay outside {@link SCALAR_CONFIG_OPTIONS}. */
const RawConfigSchema = z.object({
  detectors: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
  heapSnapshotAnalysis: z.boolean().optional(),
  heapSnapshotDir: z.string().optional(),
  waitForUrl: z.string().optional(),
  waitTimeout: durationLike().optional(),
  ...scalarConfigSchemaShape,
});

export interface LanternaConfig {
  durationMs?: number;
  output?: string;
  format?: OutputFormat;
  pretty?: boolean;
  sourceMaps?: boolean;
  sourceMapRemote?: boolean;
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

  private assign(key: ScalarConfigKey, value: LanternaConfig[ScalarConfigKey]): void {
    const mutableMerged = this.merged as Record<string, unknown>;
    mutableMerged[key] = value;
  }
}

function normalizeConfig(raw: z.infer<typeof RawConfigSchema>): LanternaConfig {
  const config: LanternaConfig = {};
  const rawValues = raw as Record<string, unknown>;
  const target = config as Record<string, unknown>;

  for (const option of SCALAR_CONFIG_OPTIONS) {
    const value = rawValues[option.raw];
    if (value !== undefined) target[option.key] = option.normalize(value);
  }

  // Irregular shapes the scalar table can't express: array merges, the nested
  // heap-snapshot object, and the waitForUrl → waitTimeout default.
  if (raw.detectors !== undefined) config.detectors = raw.detectors;
  if (raw.kinds !== undefined) config.kinds = normalizeKinds(raw.kinds);
  if (raw.heapSnapshotAnalysis !== undefined || raw.heapSnapshotDir !== undefined) {
    config.heapSnapshotAnalysis = { enabled: Boolean(raw.heapSnapshotAnalysis) };
    if (raw.heapSnapshotDir) config.heapSnapshotAnalysis.outputDir = raw.heapSnapshotDir;
  }
  if (raw.waitForUrl !== undefined) config.waitForUrl = raw.waitForUrl;
  if (raw.waitTimeout !== undefined) {
    config.waitTimeoutMs = parseDurationMs(raw.waitTimeout, 'waitTimeout');
  } else if (raw.waitForUrl !== undefined) {
    config.waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS;
  }
  return config;
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
