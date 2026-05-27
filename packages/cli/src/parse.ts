import {
  DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  DEFAULT_ASYNC_MAX_RECORDS,
  DEFAULT_ASYNC_STACK_DEPTH,
  DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  DEFAULT_MEMORY_USAGE_INTERVAL_MS,
  DEFAULT_SAMPLE_INTERVAL_MICROS,
  MAX_ASYNC_STACK_DEPTH,
  MIN_SAMPLE_INTERVAL_MICROS,
} from '@lanterna-profiler/core';
import { Command, CommanderError } from 'commander';
import { OPTION_FLAGS } from './option-descriptors.js';
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  heapSnapshotOptionName,
  normalizeKinds,
  type OutputFormat,
  PROVIDED_FLAG_ALIASES,
  parseDurationMs,
  parseHeapSamplingIntervalBytes,
  parseMemoryUsageIntervalMs,
  parseOutputFormat as parseOutputFormatValue,
  parseSampleIntervalMicros,
} from './options-normalization.js';

export type { OutputFormat } from './options-normalization.js';

interface ParsedCommonOptions {
  duration?: number;
  output?: string;
  format?: OutputFormat;
  pretty?: boolean;
  sampleInterval?: number;
  heapSampleInterval?: number;
  memoryUsageInterval?: number;
  includeMemorySamples?: boolean;
  heapSnapshotAnalysis?: boolean;
  heapSnapshotDir?: string;
  asyncMaxEvents?: number;
  asyncStackDepth?: number;
  asyncIncludeMicrotasks?: boolean;
  asyncConcurrencyInterval?: number;
  asyncInstrumentation?: 'off' | 'safe' | 'full';
  detectors?: string[];
  kind?: string[];
  /** Commander negates `--no-source-maps` to `sourceMaps: false`. Default true. */
  sourceMaps?: boolean;
}

interface NormalizedCommonOptions {
  durationMs?: number;
  output?: string;
  format: OutputFormat;
  pretty: boolean;
  sampleIntervalMicros: number;
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
  asyncMaxRecords: number;
  asyncStackDepth: number;
  asyncIncludeMicrotasks: boolean;
  asyncConcurrencyIntervalMs: number;
  asyncInstrumentation: 'off' | 'safe' | 'full';
  detectors: string[];
  kinds: string[];
  sourceMaps: boolean;
}

interface ParsedRunOptions extends ParsedCommonOptions {
  deep?: boolean;
  waitForUrl?: string;
  waitTimeout?: number;
  captureDelay?: number;
  workload?: string;
}

interface ParsedAttachOptions extends ParsedCommonOptions {
  pid?: number | true;
  inspectUrl?: string;
}

export interface RunProfileOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  format: OutputFormat;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
  sourceMaps: boolean;
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
  asyncMaxRecords: number;
  asyncStackDepth: number;
  asyncIncludeMicrotasks: boolean;
  asyncConcurrencyIntervalMs: number;
  asyncInstrumentation: 'off' | 'safe' | 'full';
  detectors: string[];
  kinds: string[];
  waitForUrl?: string;
  waitTimeoutMs?: number;
  captureDelayMs?: number;
  workload?: string;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  promptForTarget?: boolean;
  durationMs?: number;
  output?: string;
  format: OutputFormat;
  pretty: boolean;
  sampleIntervalMicros: number;
  sourceMaps: boolean;
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
  asyncMaxRecords: number;
  asyncStackDepth: number;
  asyncIncludeMicrotasks: boolean;
  asyncConcurrencyIntervalMs: number;
  asyncInstrumentation: 'off' | 'safe' | 'full';
  detectors: string[];
  kinds: string[];
}

export interface ReportOptions {
  file: string;
  output?: string;
  format: OutputFormat;
  pretty: boolean;
}

export type PsFormat = 'text' | 'json';

export interface PsOptions {
  /** Omitted means "auto": table on a TTY, JSON when piped. */
  format?: PsFormat;
  pretty: boolean;
}

const PROVIDED_FLAGS = Symbol('lanterna.providedFlags');

export function parseRunArgs(args: string[]): RunProfileOptions {
  const { optionArgs, targetCommand } = splitRunArgs(args);

  const command = createRunParser();
  parseCommand(command, optionArgs);
  const parsed = command.opts<ParsedRunOptions>();

  if (targetCommand.length === 0) {
    throw new Error('no command provided. Use: lanterna run [options] -- <command> [args...]');
  }

  const options: RunProfileOptions = {
    command: targetCommand,
    deep: Boolean(parsed.deep),
    ...normalizeCommonOptions(parsed),
  };
  applyRunOrchestrationOptions(options, parsed);
  return withProvidedFlags(options, collectProvidedFlags(optionArgs));
}

export function parseAttachArgs(args: string[]): AttachProfileOptions {
  const command = createAttachParser();
  parseCommand(command, args);
  const parsed = command.opts<ParsedAttachOptions>();

  const promptForTarget = parsed.pid === true;
  const targetCount =
    Number(parsed.pid !== undefined && parsed.pid !== true) + Number(Boolean(parsed.inspectUrl));
  if (targetCount > 1) {
    throw new Error('`lanterna attach` accepts at most one of --pid or --inspect-url');
  }

  const options: AttachProfileOptions = {
    ...normalizeCommonOptions(parsed),
  };
  if (parsed.pid !== undefined && parsed.pid !== true) options.pid = parsed.pid;
  if (promptForTarget) options.promptForTarget = true;
  if (parsed.inspectUrl) options.inspectUrl = parsed.inspectUrl;
  return withProvidedFlags(options, collectProvidedFlags(args));
}

export function parseReportArgs(args: string[]): ReportOptions {
  const command = createReportParser();
  parseCommand(command, args);
  const parsed = command.opts<Pick<ParsedCommonOptions, 'output' | 'format' | 'pretty'>>();
  const file = command.args[0];
  if (!file) {
    throw new Error('no report file provided. Use: lanterna report <file> [options]');
  }
  const options: ReportOptions = {
    file,
    format: parsed.format ?? 'text',
    pretty: Boolean(parsed.pretty),
  };
  if (parsed.output) options.output = parsed.output;
  return withProvidedFlags(options, collectProvidedFlags(args));
}

export function parsePsArgs(args: string[]): PsOptions {
  const command = createPsParser();
  parseCommand(command, args);
  const parsed = command.opts<{ format?: PsFormat; pretty?: boolean }>();
  const options: PsOptions = {
    pretty: Boolean(parsed.pretty),
  };
  if (parsed.format) options.format = parsed.format;
  return withProvidedFlags(options, collectProvidedFlags(args));
}

function normalizeCommonOptions(parsed: ParsedCommonOptions): NormalizedCommonOptions {
  const kinds = normalizeKinds(parsed.kind, ['cpu']);
  const heapSnapshotRequested = Boolean(parsed.heapSnapshotAnalysis || parsed.heapSnapshotDir);
  if (heapSnapshotRequested && !kinds.includes('memory')) {
    const option = heapSnapshotOptionName(parsed);
    throw new Error(`${option} requires --kind memory`);
  }
  const asyncFlagRequested =
    parsed.asyncMaxEvents !== undefined ||
    parsed.asyncStackDepth !== undefined ||
    parsed.asyncIncludeMicrotasks !== undefined ||
    parsed.asyncConcurrencyInterval !== undefined ||
    parsed.asyncInstrumentation !== undefined;
  if (asyncFlagRequested && !kinds.includes('async')) {
    throw new Error('--async-* options require --kind async');
  }
  const options: NormalizedCommonOptions = {
    format: parsed.format ?? 'json',
    pretty: Boolean(parsed.pretty),
    sourceMaps: parsed.sourceMaps !== false,
    sampleIntervalMicros: parsed.sampleInterval ?? DEFAULT_SAMPLE_INTERVAL_MICROS,
    heapSamplingIntervalBytes: parsed.heapSampleInterval ?? DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
    memoryUsageIntervalMs: parsed.memoryUsageInterval ?? DEFAULT_MEMORY_USAGE_INTERVAL_MS,
    includeMemoryUsageSamples: Boolean(parsed.includeMemorySamples),
    heapSnapshotAnalysis: {
      enabled: Boolean(parsed.heapSnapshotAnalysis),
    },
    asyncMaxRecords: parsed.asyncMaxEvents ?? DEFAULT_ASYNC_MAX_RECORDS,
    asyncStackDepth: parsed.asyncStackDepth ?? DEFAULT_ASYNC_STACK_DEPTH,
    asyncIncludeMicrotasks: Boolean(parsed.asyncIncludeMicrotasks),
    asyncConcurrencyIntervalMs:
      parsed.asyncConcurrencyInterval ?? DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
    asyncInstrumentation: parsed.asyncInstrumentation ?? 'safe',
    detectors: parsed.detectors ?? [],
    kinds,
  };
  if (parsed.duration !== undefined) options.durationMs = parsed.duration;
  if (parsed.output) options.output = parsed.output;
  if (parsed.heapSnapshotDir) options.heapSnapshotAnalysis.outputDir = parsed.heapSnapshotDir;
  return options;
}

function splitRunArgs(args: string[]): { optionArgs: string[]; targetCommand: string[] } {
  const separatorIndex = args.indexOf('--');
  if (separatorIndex < 0) {
    return { optionArgs: args, targetCommand: [] };
  }
  return {
    optionArgs: args.slice(0, separatorIndex),
    targetCommand: args.slice(separatorIndex + 1),
  };
}

function applyRunOrchestrationOptions(options: RunProfileOptions, parsed: ParsedRunOptions): void {
  if (parsed.waitForUrl) options.waitForUrl = parsed.waitForUrl;
  if (parsed.waitForUrl || parsed.waitTimeout !== undefined) {
    options.waitTimeoutMs = parsed.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS;
  }
  if (parsed.captureDelay !== undefined) options.captureDelayMs = parsed.captureDelay;
  if (parsed.workload) options.workload = parsed.workload;
}

function createRunParser(): Command {
  return addCommonProfilingOptions(createBaseParser('run').allowUnknownOption(false))
    .option(OPTION_FLAGS.deep, 'Enable --trace-deopt')
    .option(OPTION_FLAGS.waitForUrl, 'Wait until the target URL responds before capture')
    .option(OPTION_FLAGS.waitTimeout, 'Readiness timeout', parseDuration)
    .option(OPTION_FLAGS.captureDelay, 'Extra delay after readiness before capture', parseDuration)
    .option(OPTION_FLAGS.workload, 'Shell command to run in parallel during capture');
}

function createAttachParser(): Command {
  return addCommonProfilingOptions(createBaseParser('attach').allowUnknownOption(false))
    .option(
      OPTION_FLAGS.pid,
      'Attach to an existing Node.js pid, or open the interactive picker if no pid is provided',
      parseOptionalPid,
    )
    .option(OPTION_FLAGS.inspectUrl, 'Attach to an existing inspector WebSocket URL')
    .option(OPTION_FLAGS.deep, 'Unsupported in attach mode');
}

function addCommonProfilingOptions(command: Command): Command {
  return command
    .option(OPTION_FLAGS.duration, 'Profiling duration', parseDuration)
    .option(OPTION_FLAGS.output, 'Write report to path')
    .option(OPTION_FLAGS.format, 'Output format: json, text, markdown, or agent', parseOutputFormat)
    .option(OPTION_FLAGS.pretty, 'Pretty-print JSON')
    .option(
      OPTION_FLAGS.noSourceMaps,
      'Disable source-map resolution of frame positions (on by default)',
    )
    .option(
      OPTION_FLAGS.sampleInterval,
      'V8 sample interval in microseconds',
      parseSampleInterval,
      DEFAULT_SAMPLE_INTERVAL_MICROS,
    )
    .option(
      OPTION_FLAGS.detectors,
      'Load an additional detector plugin (package name or path). Repeatable.',
      appendRepeatableValue,
      [] as string[],
    )
    .option(
      OPTION_FLAGS.kind,
      'Profile kind to capture (default: cpu). Repeatable or comma-separated. Built-in: cpu, memory, async.',
      appendRepeatableValue,
      [] as string[],
    )
    .option(
      OPTION_FLAGS.heapSampleInterval,
      `V8 heap sampling interval, in bytes or with KiB/MiB suffix (memory kind only, default ${DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES} = 512KiB)`,
      parseHeapSampleInterval,
    )
    .option(
      OPTION_FLAGS.memoryUsageInterval,
      `process.memoryUsage() sampling cadence in ms (memory kind only, default ${DEFAULT_MEMORY_USAGE_INTERVAL_MS})`,
      parseMemoryUsageInterval,
    )
    .option(
      OPTION_FLAGS.includeMemorySamples,
      'Include raw process.memoryUsage() samples in JSON output (memory kind only)',
    )
    .option(
      OPTION_FLAGS.heapSnapshotAnalysis,
      'Capture start/end V8 heap snapshots and include a growth summary (memory kind only, opt-in and heavy)',
    )
    .option(
      OPTION_FLAGS.heapSnapshotDir,
      'Directory for start/end .heapsnapshot files (memory kind only)',
    )
    .option(
      OPTION_FLAGS.asyncMaxEvents,
      `Cap on retained async resource records (async kind only, default ${DEFAULT_ASYNC_MAX_RECORDS})`,
      parseAsyncMaxEvents,
    )
    .option(
      OPTION_FLAGS.asyncStackDepth,
      `V8 async call-stack depth (async kind only, default ${DEFAULT_ASYNC_STACK_DEPTH}, max ${MAX_ASYNC_STACK_DEPTH})`,
      parseAsyncStackDepth,
    )
    .option(
      OPTION_FLAGS.asyncIncludeMicrotasks,
      'Include TickObject / Microtask resources in the async capture (very noisy, async kind only)',
    )
    .option(
      OPTION_FLAGS.asyncConcurrencyInterval,
      `Concurrency timeline cadence in ms (async kind only, default ${DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS})`,
      parseAsyncConcurrencyInterval,
    )
    .option(
      OPTION_FLAGS.asyncInstrumentation,
      'Extra async instrumentation mode (async kind only: off, safe, full; default safe)',
      parseAsyncInstrumentation,
    );
}

function createReportParser(): Command {
  return createBaseParser('report')
    .argument('[file]')
    .option(OPTION_FLAGS.output, 'Write rendered report to path')
    .option(OPTION_FLAGS.format, 'Output format: json, text, markdown, or agent', parseOutputFormat)
    .option(OPTION_FLAGS.pretty, 'Pretty-print JSON output');
}

function createPsParser(): Command {
  return createBaseParser('ps')
    .allowUnknownOption(false)
    .option(
      OPTION_FLAGS.format,
      'Output format: text or json (default: table on a TTY, json when piped)',
      parsePsFormat,
    )
    .option(OPTION_FLAGS.pretty, 'Pretty-print JSON output');
}

function appendRepeatableValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function createBaseParser(name: string): Command {
  return new Command(name).configureOutput({
    writeErr() {
      // Lanterna normalizes parser failures itself.
    },
  });
}

function parseCommand(command: Command, args: string[]): void {
  command.exitOverride();
  try {
    command.parse(args, { from: 'user' });
  } catch (error) {
    if (!(error instanceof CommanderError)) {
      throw error;
    }
    throw new Error(normalizeCommanderError(command.name(), args, error));
  }

  if (command.name() === 'attach' && command.opts<{ deep?: boolean }>().deep) {
    throw new Error(
      '`lanterna attach` does not support --deep; attach mode cannot enable deopt tracing on an existing process',
    );
  }
}

function normalizeCommanderError(
  commandName: string,
  rawArgs: string[],
  error: CommanderError,
): string {
  const joinedArgs = rawArgs.join(' ');
  if (error.code === 'commander.unknownOption') {
    const unknownOption = /unknown option '([^']+)'/.exec(error.message)?.[1];
    if (commandName === 'run') {
      return `unknown option "${unknownOption ?? ''}" (did you forget "--" before the target command?)`;
    }
    return `unknown option "${unknownOption ?? ''}"`;
  }
  if (
    error.code === 'commander.excessArguments' &&
    commandName === 'run' &&
    joinedArgs.includes('--kind')
  ) {
    return 'unexpected profile kind argument before "--". Use --kind cpu,memory or repeat --kind for multiple profile kinds.';
  }
  if (error.code === 'commander.optionMissingArgument') {
    if (joinedArgs.includes('--duration')) return '--duration expects a value';
    if (joinedArgs.includes('--format')) return '--format expects a value';
    if (joinedArgs.includes('--inspect-url')) return '--inspect-url expects a value';
    if (joinedArgs.includes('--wait-for-url')) return '--wait-for-url expects a value';
    if (joinedArgs.includes('--wait-timeout')) return '--wait-timeout expects a value';
    if (joinedArgs.includes('--capture-delay')) return '--capture-delay expects a value';
    if (joinedArgs.includes('--workload')) return '--workload expects a value';
  }
  return error.message;
}

function parseDuration(value: string): number {
  try {
    return parseDurationMs(value);
  } catch {
    throw new CommanderError(1, 'lanterna.invalidDuration', `invalid --duration: ${value}`);
  }
}

/**
 * Accepts a heap-sampling interval expressed as bytes (`524288`), KiB
 * (`512KiB`, `512k`), or MiB (`1MiB`, `2m`). KiB/MiB use binary units
 * (1024-based). Returns the value normalized to bytes.
 */
function parseHeapSampleInterval(value: string): number {
  try {
    return parseHeapSamplingIntervalBytes(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CommanderError(
      1,
      'lanterna.invalidHeapSampleInterval',
      message.includes('min')
        ? `invalid --heap-sample-interval (min 1024 bytes / 1KiB): ${value}`
        : `invalid --heap-sample-interval: ${value} (expected e.g. 524288, 512KiB, 1MiB)`,
    );
  }
}

function parseMemoryUsageInterval(value: string): number {
  try {
    return parseMemoryUsageIntervalMs(value);
  } catch {
    throw new CommanderError(
      1,
      'lanterna.invalidMemoryUsageInterval',
      `invalid --memory-usage-interval (min 10ms): ${value}`,
    );
  }
}

function parseOutputFormat(value: string): OutputFormat {
  try {
    return parseOutputFormatValue(value);
  } catch {
    throw new CommanderError(
      1,
      'lanterna.invalidFormat',
      `invalid --format: ${value} (expected json, text, markdown, or agent)`,
    );
  }
}

function parsePsFormat(value: string): PsFormat {
  if (value === 'text' || value === 'json') return value;
  throw new CommanderError(
    1,
    'lanterna.invalidFormat',
    `invalid --format: ${value} (expected text or json)`,
  );
}

function parseSampleInterval(value: string): number {
  try {
    return parseSampleIntervalMicros(value);
  } catch {
    throw new CommanderError(
      1,
      'lanterna.invalidSampleInterval',
      `invalid --sample-interval (min ${MIN_SAMPLE_INTERVAL_MICROS}): ${value}`,
    );
  }
}

function parseAsyncMaxEvents(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100) {
    throw new CommanderError(
      1,
      'lanterna.invalidAsyncMaxEvents',
      `invalid --async-max-events (min 100): ${value}`,
    );
  }
  return parsed;
}

function parseAsyncStackDepth(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_ASYNC_STACK_DEPTH) {
    throw new CommanderError(
      1,
      'lanterna.invalidAsyncStackDepth',
      `invalid --async-stack-depth (range 0..${MAX_ASYNC_STACK_DEPTH}): ${value}`,
    );
  }
  return parsed;
}

function parseAsyncConcurrencyInterval(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10) {
    throw new CommanderError(
      1,
      'lanterna.invalidAsyncConcurrencyInterval',
      `invalid --async-concurrency-interval (min 10ms): ${value}`,
    );
  }
  return parsed;
}

function parseAsyncInstrumentation(value: string): 'off' | 'safe' | 'full' {
  if (value === 'off' || value === 'safe' || value === 'full') return value;
  throw new CommanderError(
    1,
    'lanterna.invalidAsyncInstrumentation',
    `invalid --async-instrumentation: ${value} (expected off, safe, or full)`,
  );
}

function parsePid(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CommanderError(1, 'lanterna.invalidPid', `invalid --pid: ${value}`);
  }
  return parsed;
}

function parseOptionalPid(value: string | undefined): number | true {
  if (value === undefined) return true;
  return parsePid(value);
}

export type RunOptions = RunProfileOptions;
export type AttachOptions = AttachProfileOptions;

export function getProvidedFlags(options: object): ReadonlySet<string> {
  return Reflect.get(options, PROVIDED_FLAGS) ?? new Set<string>();
}

function withProvidedFlags<T extends object>(options: T, providedFlags: Set<string>): T {
  Object.defineProperty(options, PROVIDED_FLAGS, {
    value: providedFlags,
    enumerable: false,
    configurable: false,
  });
  return options;
}

function collectProvidedFlags(args: string[]): Set<string> {
  const provided = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') break;
    if (arg === '-o') {
      provided.add('output');
      continue;
    }
    if (!arg?.startsWith('--')) continue;
    const name = arg.slice(2).split('=')[0] ?? '';
    if (name) provided.add(normalizeFlagName(name));
  }
  return provided;
}

function normalizeFlagName(flag: string): string {
  return PROVIDED_FLAG_ALIASES[flag] ?? flag;
}
