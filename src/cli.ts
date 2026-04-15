import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AttachSource } from './collector/attach-source.js';
import { SpawnSource } from './collector/spawn-source.js';
import { enrich } from './enricher/index.js';
import { serializeReport } from './report/write.js';

const USAGE = `lanterna — agent-first Node.js CPU profiler

Usage:
  lanterna run [options] -- <command> [args...]
  lanterna attach [options]

Options:
  --duration <ms|s|m>     Profiling duration (e.g. 30s, 5000). Default: runs until the child exits.
  --output <path>         Write JSON report to path (default: stdout)
  --pretty                Pretty-print JSON (2-space indent)
  --deep                  Enable --trace-deopt to feed deopt-loop detector (adds stderr noise)
  --sample-interval <us>  V8 sample interval in microseconds (default: 1000)
  --pid <pid>             Attach to an existing Node.js pid
  --inspect-url <url>     Attach to an existing inspector WebSocket URL
  -h, --help              Show this help

Examples:
  lanterna run --duration 30s --output report.json -- node app.js
  lanterna run --deep -- node app.js | jq '.findings'
  lanterna attach --pid 4242 --duration 15s --output report.json
`;

interface RunOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
}

interface AttachOptions {
  pid?: number;
  inspectUrl?: string;
  durationMs: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros: number;
}

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return;
  }

  const [sub, ...rest] = argv;
  if (sub === 'run') {
    const opts = parseRunArgs(rest);
    await runCommand(opts);
    return;
  }
  if (sub === 'attach') {
    const opts = parseAttachArgs(rest);
    await attachCommand(opts);
    return;
  }

  if (sub !== 'run' && sub !== 'attach') {
    process.stderr.write(`lanterna: unknown command "${sub}"\n\n${USAGE}`);
    process.exit(2);
  }
}

export function parseRunArgs(args: string[]): RunOptions {
  const opts: RunOptions = {
    command: [],
    pretty: false,
    deep: false,
    sampleIntervalMicros: 1000,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === '--') {
      opts.command = args.slice(i + 1);
      break;
    }
    if (a === '--duration') {
      opts.durationMs = parseDuration(args[++i]);
    } else if (a === '--output' || a === '-o') {
      opts.output = args[++i];
    } else if (a === '--pretty') {
      opts.pretty = true;
    } else if (a === '--deep') {
      opts.deep = true;
    } else if (a === '--sample-interval') {
      opts.sampleIntervalMicros = Number(args[++i]);
      if (!Number.isFinite(opts.sampleIntervalMicros) || opts.sampleIntervalMicros < 50) {
        throw new Error(`invalid --sample-interval (min 50): ${args[i]}`);
      }
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      throw new Error(`unknown option "${a}" (did you forget "--" before the target command?)`);
    }
    i++;
  }

  if (opts.command.length === 0) {
    throw new Error('no command provided. Use: lanterna run [options] -- <command> [args...]');
  }
  return opts;
}

function parseDuration(s: string | undefined): number {
  if (!s) throw new Error('--duration expects a value');
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/i.exec(s);
  if (!m) throw new Error(`invalid --duration: ${s}`);
  const n = Number(m[1]);
  const unit = (m[2] || 'ms').toLowerCase();
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  return n;
}

async function runCommand(opts: RunOptions): Promise<void> {
  const source = new SpawnSource();
  const handle = await source.start({
    command: opts.command,
    sampleIntervalMicros: opts.sampleIntervalMicros,
    deep: opts.deep,
  });

  if (opts.durationMs !== undefined) {
    await Promise.race([sleep(opts.durationMs), handle.waitForExit()]);
  } else {
    await handle.waitForExit();
  }

  const raw = await handle.stop();
  const report = enrich(raw, {
    sampleIntervalMicros: opts.sampleIntervalMicros,
    deep: opts.deep,
    command: opts.command,
    mode: 'spawn',
  });
  await writeReport(report, opts.output, opts.pretty);
}

export function parseAttachArgs(args: string[]): AttachOptions {
  const opts: Partial<AttachOptions> & { pretty: boolean; sampleIntervalMicros: number } = {
    pretty: false,
    sampleIntervalMicros: 1000,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--duration') {
      opts.durationMs = parseDuration(args[++i]);
    } else if (arg === '--output' || arg === '-o') {
      opts.output = args[++i];
    } else if (arg === '--pretty') {
      opts.pretty = true;
    } else if (arg === '--sample-interval') {
      opts.sampleIntervalMicros = Number(args[++i]);
      if (!Number.isFinite(opts.sampleIntervalMicros) || opts.sampleIntervalMicros < 50) {
        throw new Error(`invalid --sample-interval (min 50): ${args[i]}`);
      }
    } else if (arg === '--pid') {
      opts.pid = Number(args[++i]);
      if (!Number.isInteger(opts.pid) || opts.pid <= 0) {
        throw new Error(`invalid --pid: ${args[i]}`);
      }
    } else if (arg === '--inspect-url') {
      opts.inspectUrl = args[++i];
      if (!opts.inspectUrl) throw new Error('--inspect-url expects a value');
    } else if (arg === '--deep') {
      throw new Error('`lanterna attach` does not support --deep; attach mode cannot enable deopt tracing on an existing process');
    } else if (arg === '--') {
      throw new Error('`lanterna attach` does not accept a target command; use --pid or --inspect-url');
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      throw new Error(`unknown option "${arg}"`);
    }
    i++;
  }

  if (opts.durationMs === undefined) {
    throw new Error('`lanterna attach` requires --duration so the capture can stop without controlling the target process');
  }
  const targetCount = Number(opts.pid !== undefined) + Number(Boolean(opts.inspectUrl));
  if (targetCount !== 1) {
    throw new Error('`lanterna attach` requires exactly one of --pid or --inspect-url');
  }

  return opts as AttachOptions;
}

async function attachCommand(opts: AttachOptions): Promise<void> {
  const source = new AttachSource();
  const handle = await source.start({
    pid: opts.pid,
    inspectUrl: opts.inspectUrl,
    sampleIntervalMicros: opts.sampleIntervalMicros,
  });

  await Promise.race([sleep(opts.durationMs), handle.waitForExit()]);

  const raw = await handle.stop();
  const report = enrich(raw, {
    sampleIntervalMicros: opts.sampleIntervalMicros,
    deep: false,
    command: [],
    mode: 'attach',
  });
  await writeReport(report, opts.output, opts.pretty);
}

async function writeReport(
  report: Parameters<typeof serializeReport>[0],
  output: string | undefined,
  pretty: boolean,
): Promise<void> {
  const json = serializeReport(report, { pretty });
  if (output) {
    await writeFile(resolve(output), json + '\n', 'utf8');
    process.stderr.write(`lanterna: report written to ${output}\n`);
    return;
  }
  process.stdout.write(json + '\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
