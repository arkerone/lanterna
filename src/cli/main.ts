import chalk from 'chalk';
import { attachCommand } from './commands/attach.js';
import { runCommand } from './commands/run.js';
import { parseAttachArgs, parseRunArgs } from './parse.js';

const GLOBAL_HELP = `${chalk.bold.cyan('lanterna')} ${chalk.gray('Agent-first Node.js CPU profiler')}

${chalk.bold('Usage')}
  ${chalk.cyan('lanterna run')} ${chalk.gray('[options] -- <command> [args...]')}
  ${chalk.cyan('lanterna attach')} ${chalk.gray('[options]')}

${chalk.bold('Commands')}
  ${chalk.cyan('run')}     Start a new Node.js command under Lanterna and capture a CPU profile
  ${chalk.cyan('attach')}  Attach to a running Node.js process by PID, inspector URL, or interactive selection

${chalk.bold('Global Options')}
  ${chalk.cyan('--duration <ms|s|m>')}     Profiling duration, for example ${chalk.gray('15s')} or ${chalk.gray('5000ms')}
  ${chalk.cyan('--output, -o <path>')}     Write the JSON report to a file instead of stdout
  ${chalk.cyan('--pretty')}                Pretty-print JSON output
  ${chalk.cyan('--sample-interval <us>')}  V8 sample interval in microseconds ${chalk.gray('(default: 1000)')}
  ${chalk.cyan('-h, --help')}              Show this help

${chalk.bold('Run Options')}
  ${chalk.cyan('--deep')}                  Enable deopt tracing for ${chalk.cyan('run')} ${chalk.gray('(stderr becomes noisier)')}

${chalk.bold('Attach Options')}
  ${chalk.cyan('--pid [pid]')}             Attach by PID, or open the interactive picker if no pid is provided
  ${chalk.cyan('--inspect-url <url>')}     Attach directly to an existing inspector WebSocket URL
  ${chalk.gray('omit --duration')}         Keep profiling until the target exits or you stop Lanterna with ${chalk.cyan('Ctrl+C')}
  ${chalk.gray('--pid with no value')}     Open the interactive process picker in a TTY

${chalk.bold('Examples')}
  ${chalk.gray('# Run a fresh process under the profiler')}
  lanterna run --duration 30s --output report.json -- node app.js

  ${chalk.gray('# Run with deopt tracing')}
  lanterna run --deep --duration 15s -- node server.js

  ${chalk.gray('# Attach directly by PID')}
  lanterna attach --pid 4242 --duration 15s --output report.json

  ${chalk.gray('# Attach until you stop it manually')}
  lanterna attach --pid 4242

  ${chalk.gray('# Open the interactive picker')}
  lanterna attach --pid
`;

const RUN_HELP = `${chalk.bold.cyan('lanterna run')} ${chalk.gray('Profile a fresh Node.js command')}

${chalk.bold('Usage')}
  ${chalk.cyan('lanterna run')} ${chalk.gray('[options] -- <command> [args...]')}

${chalk.bold('Options')}
  ${chalk.cyan('--duration <ms|s|m>')}     Stop automatically after the given duration
  ${chalk.cyan('--output, -o <path>')}     Write the JSON report to a file
  ${chalk.cyan('--pretty')}                Pretty-print JSON output
  ${chalk.cyan('--deep')}                  Enable deopt tracing ${chalk.gray('(stderr becomes noisier)')}
  ${chalk.cyan('--sample-interval <us>')}  V8 sample interval in microseconds ${chalk.gray('(default: 1000)')}
  ${chalk.cyan('-h, --help')}              Show this help

${chalk.bold('Examples')}
  lanterna run --duration 15s --output report.json -- node server.js
  lanterna run --deep --duration 15s -- node server.js
  lanterna run --pretty -- node script.js

${chalk.bold('Notes')}
  - The ${chalk.cyan('--')} separator is required before the target command
  - Without ${chalk.cyan('--duration')}, Lanterna profiles until the child process exits
`;

const ATTACH_HELP = `${chalk.bold.cyan('lanterna attach')} ${chalk.gray('Attach to a running Node.js process')}

${chalk.bold('Usage')}
  ${chalk.cyan('lanterna attach')} ${chalk.gray('[options]')}

${chalk.bold('Options')}
  ${chalk.cyan('--pid [pid]')}             Attach by PID, or open the interactive picker if no pid is provided
  ${chalk.cyan('--inspect-url <url>')}     Attach directly to an existing inspector WebSocket URL
  ${chalk.cyan('--duration <ms|s|m>')}     Stop automatically after the given duration
  ${chalk.cyan('--output, -o <path>')}     Write the JSON report to a file
  ${chalk.cyan('--pretty')}                Pretty-print JSON output
  ${chalk.cyan('--sample-interval <us>')}  V8 sample interval in microseconds ${chalk.gray('(default: 1000)')}
  ${chalk.cyan('-h, --help')}              Show this help

${chalk.bold('Examples')}
  lanterna attach --pid 4242 --duration 15s
  lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --duration 15s
  lanterna attach --pid 4242
  lanterna attach --pid

${chalk.bold('Notes')}
  - Without ${chalk.cyan('--duration')}, Lanterna runs until the target exits or you stop it with ${chalk.cyan('Ctrl+C')}
  - ${chalk.cyan('--pid')} with no value opens the interactive picker in a TTY
  - ${chalk.cyan('--deep')} is not supported in attach mode
`;

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(GLOBAL_HELP);
    return;
  }

  const [subcommand, ...rest] = argv;
  if (subcommand === 'run') {
    if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
      process.stdout.write(RUN_HELP);
      return;
    }
    await runCommand(parseRunArgs(rest));
    return;
  }
  if (subcommand === 'attach') {
    if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
      process.stdout.write(ATTACH_HELP);
      return;
    }
    await attachCommand(parseAttachArgs(rest));
    return;
  }

  process.stderr.write(`Unknown command: ${subcommand}\n\n${GLOBAL_HELP}`);
  process.exitCode = 2;
}

export { GLOBAL_HELP, RUN_HELP, ATTACH_HELP };
