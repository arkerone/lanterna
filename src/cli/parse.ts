import { Command, CommanderError } from 'commander';
import { DEFAULT_SAMPLE_INTERVAL_MICROS, MIN_SAMPLE_INTERVAL_MICROS } from '../shared/config.js';

export interface RunProfileOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  promptForTarget?: boolean;
  durationMs?: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros: number;
}

export function parseRunArgs(args: string[]): RunProfileOptions {
  const separatorIndex = args.indexOf('--');
  const optionArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const targetCommand = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];

  const command = createRunParser();
  parseCommand(command, optionArgs);
  const parsed = command.opts<{
    duration?: number;
    output?: string;
    pretty?: boolean;
    deep?: boolean;
    sampleInterval?: number;
  }>();

  if (targetCommand.length === 0) {
    throw new Error('no command provided. Use: lanterna run [options] -- <command> [args...]');
  }

  return {
    command: targetCommand,
    durationMs: parsed.duration,
    output: parsed.output,
    pretty: Boolean(parsed.pretty),
    deep: Boolean(parsed.deep),
    sampleIntervalMicros: parsed.sampleInterval ?? DEFAULT_SAMPLE_INTERVAL_MICROS,
  };
}

export function parseAttachArgs(args: string[]): AttachProfileOptions {
  const command = createAttachParser();
  parseCommand(command, args);
  const parsed = command.opts<{
    duration?: number;
    output?: string;
    pretty?: boolean;
    sampleInterval?: number;
    pid?: number | true;
    inspectUrl?: string;
  }>();

  const promptForTarget = parsed.pid === true;
  const targetCount = Number(parsed.pid !== undefined && parsed.pid !== true) + Number(Boolean(parsed.inspectUrl));
  if (targetCount > 1) {
    throw new Error('`lanterna attach` accepts at most one of --pid or --inspect-url');
  }

  return {
    ...(parsed.duration !== undefined ? { durationMs: parsed.duration } : {}),
    pretty: Boolean(parsed.pretty),
    sampleIntervalMicros: parsed.sampleInterval ?? DEFAULT_SAMPLE_INTERVAL_MICROS,
    ...(parsed.pid !== undefined && parsed.pid !== true ? { pid: parsed.pid } : {}),
    ...(promptForTarget ? { promptForTarget: true } : {}),
    ...(parsed.inspectUrl ? { inspectUrl: parsed.inspectUrl } : {}),
    ...(parsed.output ? { output: parsed.output } : {}),
  };
}

function createRunParser(): Command {
  return createBaseParser('run')
    .allowUnknownOption(false)
    .option('--duration <value>', 'Profiling duration', parseDuration)
    .option('--output, -o <path>', 'Write JSON report to path')
    .option('--pretty', 'Pretty-print JSON')
    .option('--deep', 'Enable --trace-deopt')
    .option('--sample-interval <us>', 'V8 sample interval in microseconds', parseSampleInterval, DEFAULT_SAMPLE_INTERVAL_MICROS);
}

function createAttachParser(): Command {
  return createBaseParser('attach')
    .allowUnknownOption(false)
    .option('--duration <value>', 'Profiling duration', parseDuration)
    .option('--output, -o <path>', 'Write JSON report to path')
    .option('--pretty', 'Pretty-print JSON')
    .option('--sample-interval <us>', 'V8 sample interval in microseconds', parseSampleInterval, DEFAULT_SAMPLE_INTERVAL_MICROS)
    .option('--pid [pid]', 'Attach to an existing Node.js pid, or open the interactive picker if no pid is provided', parseOptionalPid)
    .option('--inspect-url <url>', 'Attach to an existing inspector WebSocket URL')
    .option('--deep', 'Unsupported in attach mode');
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
    throw new Error('`lanterna attach` does not support --deep; attach mode cannot enable deopt tracing on an existing process');
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
    if (joinedArgs.includes('--inspect-url')) return '--inspect-url expects a value';
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

function parseSampleInterval(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_SAMPLE_INTERVAL_MICROS) {
    throw new CommanderError(1, 'lanterna.invalidSampleInterval', `invalid --sample-interval (min ${MIN_SAMPLE_INTERVAL_MICROS}): ${value}`);
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
