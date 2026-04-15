import { attachCommand } from './commands/attach.js';
import { runCommand } from './commands/run.js';
import { parseAttachArgs, parseRunArgs } from './parse.js';
import { logger } from '../shared/logger.js';

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

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return;
  }

  const [subcommand, ...rest] = argv;
  if (subcommand === 'run') {
    await runCommand(parseRunArgs(rest));
    return;
  }
  if (subcommand === 'attach') {
    await attachCommand(parseAttachArgs(rest));
    return;
  }

  logger.warn({ subcommand, usage: USAGE }, 'unknown command');
  process.exitCode = 2;
}
