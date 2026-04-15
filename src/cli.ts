import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SpawnSource } from './collector/spawn-source.js';
import { enrich } from './enricher/index.js';
import { serializeReport } from './report/write.js';

const USAGE = `lanterna — agent-first Node.js CPU profiler

Usage:
  lanterna run [options] -- <command> [args...]

Options:
  --duration <ms|s>       Profiling duration (e.g. 30s, 5000). Default: runs until the child exits.
  --output <path>         Write JSON report to path (default: stdout)
  --pretty                Pretty-print JSON (2-space indent)
  --deep                  Enable --trace-deopt to feed deopt-loop detector (adds stderr noise)
  --sample-interval <us>  V8 sample interval in microseconds (default: 1000)
  -h, --help              Show this help

Examples:
  lanterna run --duration 30s --output report.json -- node app.js
  lanterna run --deep -- node app.js | jq '.findings'
`;

interface RunOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
}

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return;
  }

  const [sub, ...rest] = argv;
  if (sub !== 'run') {
    process.stderr.write(`lanterna: unknown command "${sub}"\n\n${USAGE}`);
    process.exit(2);
  }

  const opts = parseRunArgs(rest);
  await runCommand(opts);
}

function parseRunArgs(args: string[]): RunOptions {
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
  });

  const json = serializeReport(report, { pretty: opts.pretty });
  if (opts.output) {
    await writeFile(resolve(opts.output), json + '\n', 'utf8');
    process.stderr.write(`lanterna: report written to ${opts.output}\n`);
  } else {
    process.stdout.write(json + '\n');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
