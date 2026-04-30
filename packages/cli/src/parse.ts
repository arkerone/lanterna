import {
  DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
  DEFAULT_MEMORY_USAGE_INTERVAL_MS,
  DEFAULT_SAMPLE_INTERVAL_MICROS,
  MIN_SAMPLE_INTERVAL_MICROS,
} from '@lanterna-profiler/core';
import { Command, CommanderError } from 'commander';

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
  detectors?: string[];
  kind?: string[];
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
  detectors: string[];
  kinds: string[];
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
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
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
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
  detectors: string[];
  kinds: string[];
}

export interface ReportOptions {
  file: string;
  output?: string;
  format: OutputFormat;
  pretty: boolean;
}

export type OutputFormat = 'json' | 'text' | 'markdown';

const PROVIDED_FLAGS = Symbol('lanterna.providedFlags');
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export function parseRunArgs(args: string[]): RunProfileOptions {
  const separatorIndex = args.indexOf('--');
  const optionArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const targetCommand = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];

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
    ...(parsed.waitForUrl ? { waitForUrl: parsed.waitForUrl } : {}),
    ...(parsed.waitForUrl || parsed.waitTimeout !== undefined
      ? { waitTimeoutMs: parsed.waitTimeout ?? DEFAULT_WAIT_TIMEOUT_MS }
      : {}),
    ...(parsed.captureDelay !== undefined ? { captureDelayMs: parsed.captureDelay } : {}),
    ...(parsed.workload ? { workload: parsed.workload } : {}),
  };
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
    ...(parsed.pid !== undefined && parsed.pid !== true ? { pid: parsed.pid } : {}),
    ...(promptForTarget ? { promptForTarget: true } : {}),
    ...(parsed.inspectUrl ? { inspectUrl: parsed.inspectUrl } : {}),
  };
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
    ...(parsed.output ? { output: parsed.output } : {}),
    format: parsed.format ?? 'text',
    pretty: Boolean(parsed.pretty),
  };
  return withProvidedFlags(options, collectProvidedFlags(args));
}

function normalizeCommonOptions(parsed: ParsedCommonOptions): NormalizedCommonOptions {
  const kinds = resolveKinds(parsed.kind);
  const heapSnapshotRequested = Boolean(parsed.heapSnapshotAnalysis || parsed.heapSnapshotDir);
  if (heapSnapshotRequested && !kinds.includes('memory')) {
    const option = parsed.heapSnapshotAnalysis ? '--heap-snapshot-analysis' : '--heap-snapshot-dir';
    throw new Error(`${option} requires --kind memory`);
  }
  return {
    ...(parsed.duration !== undefined ? { durationMs: parsed.duration } : {}),
    ...(parsed.output ? { output: parsed.output } : {}),
    format: parsed.format ?? 'json',
    pretty: Boolean(parsed.pretty),
    sampleIntervalMicros: parsed.sampleInterval ?? DEFAULT_SAMPLE_INTERVAL_MICROS,
    heapSamplingIntervalBytes: parsed.heapSampleInterval ?? DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES,
    memoryUsageIntervalMs: parsed.memoryUsageInterval ?? DEFAULT_MEMORY_USAGE_INTERVAL_MS,
    includeMemoryUsageSamples: Boolean(parsed.includeMemorySamples),
    heapSnapshotAnalysis: {
      enabled: Boolean(parsed.heapSnapshotAnalysis),
      ...(parsed.heapSnapshotDir ? { outputDir: parsed.heapSnapshotDir } : {}),
    },
    detectors: parsed.detectors ?? [],
    kinds,
  };
}

function resolveKinds(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) return ['cpu'];
  // Allow `--kind cpu,memory` shorthand in addition to repeated flags.
  const expanded = raw.flatMap((value) =>
    value
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean),
  );
  // De-dupe while preserving first-seen order.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const kind of expanded) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    ordered.push(kind);
  }
  return ordered;
}

function createRunParser(): Command {
  return addCommonProfilingOptions(createBaseParser('run').allowUnknownOption(false))
    .option('--deep', 'Enable --trace-deopt')
    .option('--wait-for-url <url>', 'Wait until the target URL responds before capture')
    .option('--wait-timeout <value>', 'Readiness timeout', parseDuration)
    .option('--capture-delay <value>', 'Extra delay after readiness before capture', parseDuration)
    .option('--workload <command>', 'Shell command to run in parallel during capture');
}

function createAttachParser(): Command {
  return addCommonProfilingOptions(createBaseParser('attach').allowUnknownOption(false))
    .option(
      '--pid [pid]',
      'Attach to an existing Node.js pid, or open the interactive picker if no pid is provided',
      parseOptionalPid,
    )
    .option('--inspect-url <url>', 'Attach to an existing inspector WebSocket URL')
    .option('--deep', 'Unsupported in attach mode');
}

function addCommonProfilingOptions(command: Command): Command {
  return command
    .option('--duration <value>', 'Profiling duration', parseDuration)
    .option('--output, -o <path>', 'Write report to path')
    .option('--format <format>', 'Output format: json, text, or markdown', parseOutputFormat)
    .option('--pretty', 'Pretty-print JSON')
    .option(
      '--sample-interval <us>',
      'V8 sample interval in microseconds',
      parseSampleInterval,
      DEFAULT_SAMPLE_INTERVAL_MICROS,
    )
    .option(
      '--detectors <spec>',
      'Load an additional detector plugin (package name or path). Repeatable.',
      appendRepeatableValue,
      [] as string[],
    )
    .option(
      '--kind <id>',
      'Profile kind to capture (default: cpu). Repeatable or comma-separated. Built-in: cpu, memory.',
      appendRepeatableValue,
      [] as string[],
    )
    .option(
      '--heap-sample-interval <size>',
      `V8 heap sampling interval, in bytes or with KiB/MiB suffix (memory kind only, default ${DEFAULT_MEMORY_SAMPLING_INTERVAL_BYTES} = 512KiB)`,
      parseHeapSampleInterval,
    )
    .option(
      '--memory-usage-interval <ms>',
      `process.memoryUsage() sampling cadence in ms (memory kind only, default ${DEFAULT_MEMORY_USAGE_INTERVAL_MS})`,
      parseMemoryUsageInterval,
    )
    .option(
      '--include-memory-samples',
      'Include raw process.memoryUsage() samples in JSON output (memory kind only)',
    )
    .option(
      '--heap-snapshot-analysis',
      'Capture start/end V8 heap snapshots and include a growth summary (memory kind only, opt-in and heavy)',
    )
    .option(
      '--heap-snapshot-dir <dir>',
      'Directory for start/end .heapsnapshot files (memory kind only)',
    );
}

function createReportParser(): Command {
  return createBaseParser('report')
    .argument('[file]')
    .option('--output, -o <path>', 'Write rendered report to path')
    .option('--format <format>', 'Output format: json, text, or markdown', parseOutputFormat)
    .option('--pretty', 'Pretty-print JSON output');
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
    throw new Error(normalizeCommanderError(command.name(), args.slice(1), error));
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
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(value);
  if (!match) {
    throw new CommanderError(1, 'lanterna.invalidDuration', `invalid --duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60_000;
  return amount;
}

/**
 * Accepts a heap-sampling interval expressed as bytes (`524288`), KiB
 * (`512KiB`, `512k`), or MiB (`1MiB`, `2m`). KiB/MiB use binary units
 * (1024-based). Returns the value normalized to bytes.
 */
function parseHeapSampleInterval(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kib|kb|k|mib|mb|m)?$/i.exec(value.trim());
  if (!match) {
    throw new CommanderError(
      1,
      'lanterna.invalidHeapSampleInterval',
      `invalid --heap-sample-interval: ${value} (expected e.g. 524288, 512KiB, 1MiB)`,
    );
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  let bytes: number;
  if (unit === 'mib' || unit === 'mb' || unit === 'm') bytes = amount * 1024 * 1024;
  else if (unit === 'kib' || unit === 'kb' || unit === 'k') bytes = amount * 1024;
  else bytes = amount;
  bytes = Math.round(bytes);
  if (!Number.isFinite(bytes) || bytes < 1024) {
    throw new CommanderError(
      1,
      'lanterna.invalidHeapSampleInterval',
      `invalid --heap-sample-interval (min 1024 bytes / 1KiB): ${value}`,
    );
  }
  return bytes;
}

function parseMemoryUsageInterval(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 10) {
    throw new CommanderError(
      1,
      'lanterna.invalidMemoryUsageInterval',
      `invalid --memory-usage-interval (min 10ms): ${value}`,
    );
  }
  return parsed;
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === 'json' || value === 'text' || value === 'markdown') return value;
  throw new CommanderError(
    1,
    'lanterna.invalidFormat',
    `invalid --format: ${value} (expected json, text, or markdown)`,
  );
}

function parseSampleInterval(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_SAMPLE_INTERVAL_MICROS) {
    throw new CommanderError(
      1,
      'lanterna.invalidSampleInterval',
      `invalid --sample-interval (min ${MIN_SAMPLE_INTERVAL_MICROS}): ${value}`,
    );
  }
  return parsed;
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
  const aliases: Record<string, string> = {
    'heap-sample-interval': 'heapSamplingIntervalBytes',
    'memory-usage-interval': 'memoryUsageIntervalMs',
    'include-memory-samples': 'includeMemoryUsageSamples',
    'heap-snapshot-analysis': 'heapSnapshotAnalysis',
    'heap-snapshot-dir': 'heapSnapshotAnalysis',
    'sample-interval': 'sampleIntervalMicros',
    'wait-for-url': 'waitForUrl',
    'wait-timeout': 'waitTimeoutMs',
    'capture-delay': 'captureDelayMs',
    detectors: 'detectors',
    kind: 'kind',
    duration: 'durationMs',
    output: 'output',
    format: 'format',
    pretty: 'pretty',
    workload: 'workload',
  };
  return aliases[flag] ?? flag;
}
