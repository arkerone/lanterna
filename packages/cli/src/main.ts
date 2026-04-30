import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { AttachSelectionCancelledError } from './attach-target.js';
import { attachCommand } from './commands/attach.js';
import { reportCommand } from './commands/report.js';
import { runCommand } from './commands/run.js';
import {
  formatExamples,
  formatFooterHint,
  formatNotes,
  formatOptionRow,
  formatSection,
  formatUnknownCommandError,
} from './help.js';
import { parseAttachArgs, parseReportArgs, parseRunArgs } from './parse.js';
import { renderBrandHeader, renderCommandHeader } from './terminal-style.js';

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/main.js → ../package.json
    const pkgPath = resolve(here, '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = readPackageVersion();

const memoryOptionRows = [
  formatOptionRow(
    '--heap-sample-interval <size>',
    'V8 heap sampling interval (bytes or KiB/MiB)',
    'memory kind, default 512KiB',
  ),
  formatOptionRow(
    '--memory-usage-interval <ms>',
    'process.memoryUsage() cadence in ms',
    'memory kind, default 250',
  ),
  formatOptionRow(
    '--include-memory-samples',
    'Include raw process.memoryUsage() samples in JSON output',
    'memory kind',
  ),
  formatOptionRow(
    '--heap-snapshot-analysis',
    'Capture start/end heap snapshots and summarize retained growth',
    'memory kind, heavy',
  ),
  formatOptionRow(
    '--heap-snapshot-dir <dir>',
    'Directory for .heapsnapshot files',
    'memory kind, default .lanterna-heapsnapshots',
  ),
];

const captureRunRows = [
  formatOptionRow('--duration <ms|s|m>', 'Stop automatically after the given duration'),
  formatOptionRow(
    '--kind <id>',
    'Profile kind to capture. Repeatable or comma-separated',
    'default cpu, built-in: cpu, memory',
  ),
  formatOptionRow(
    '--sample-interval <us>',
    'V8 CPU sample interval in microseconds',
    'default 1000',
  ),
  formatOptionRow('--deep', 'Enable deopt tracing', 'stderr becomes noisier'),
  formatOptionRow('--wait-for-url <url>', 'Wait for app readiness before capture'),
  formatOptionRow('--wait-timeout <ms|s|m>', 'Readiness timeout', 'default 30s'),
  formatOptionRow('--capture-delay <ms|s|m>', 'Extra delay after readiness before capture'),
  formatOptionRow('--workload <command>', 'Shell command to run in parallel during capture'),
];

const captureAttachRows = [
  formatOptionRow(
    '--pid [pid]',
    'Attach by PID, or open the interactive picker if no pid is given',
  ),
  formatOptionRow('--inspect-url <url>', 'Attach to an existing inspector WebSocket URL'),
  formatOptionRow('--duration <ms|s|m>', 'Stop automatically after the given duration'),
  formatOptionRow(
    '--kind <id>',
    'Profile kind to capture. Repeatable or comma-separated',
    'default cpu, built-in: cpu, memory',
  ),
  formatOptionRow(
    '--sample-interval <us>',
    'V8 CPU sample interval in microseconds',
    'default 1000',
  ),
];

const outputRows = [
  formatOptionRow('--output, -o <path>', 'Write report output to a file'),
  formatOptionRow('--format <format>', 'Output format', 'json, text, markdown'),
  formatOptionRow('--pretty', 'Pretty-print JSON output'),
];

const pluginRows = [
  formatOptionRow(
    '--detectors <spec>',
    'Load an additional detector plugin (package name or path). Repeatable',
  ),
];

const generalRows = [formatOptionRow('-h, --help', 'Show this help')];

const GLOBAL_HELP = `${renderBrandHeader({
  subtitle: 'Agent-first Node.js profiler',
  accent: 'CPU and memory captures for real Node.js workloads',
})}

${formatSection('Usage', [
  `  ${chalk.cyan('lanterna run')} ${chalk.gray('[options] -- <command> [args...]')}`,
  `  ${chalk.cyan('lanterna attach')} ${chalk.gray('[options]')}`,
  `  ${chalk.cyan('lanterna report')} ${chalk.gray('<file> [options]')}`,
])}

${formatSection('Commands', [
  formatOptionRow('run', 'Start a Node.js command under Lanterna and capture a profile'),
  formatOptionRow('attach', 'Attach to a running Node.js process by PID, URL, or picker'),
  formatOptionRow('report', 'Render an existing Lanterna JSON report'),
])}

${formatSection('Common options', [
  formatOptionRow('--duration <ms|s|m>', 'Profiling duration', 'e.g. 15s or 5000ms'),
  formatOptionRow('--output, -o <path>', 'Write report output to a file instead of stdout'),
  formatOptionRow('--format <format>', 'Output format', 'json, text, markdown'),
  formatOptionRow('--pretty', 'Pretty-print JSON output'),
  formatOptionRow(
    '--kind <id>',
    'Profile kind to capture. Repeatable or comma-separated',
    'default cpu, built-in: cpu, memory',
  ),
  formatOptionRow(
    '--sample-interval <us>',
    'V8 CPU sample interval in microseconds',
    'default 1000',
  ),
  formatOptionRow('--detectors <spec>', 'Load an additional detector plugin. Repeatable'),
])}

${formatSection('Run-only options', [
  formatOptionRow('--deep', 'Enable deopt tracing', 'stderr becomes noisier'),
  formatOptionRow('--wait-for-url <url>', 'Wait for app readiness before capture'),
  formatOptionRow('--wait-timeout <ms|s|m>', 'Readiness timeout', 'default 30s'),
  formatOptionRow('--capture-delay <ms|s|m>', 'Extra delay after readiness before capture'),
  formatOptionRow('--workload <command>', 'Shell command to run during capture'),
])}

${formatSection('Attach-only options', [
  formatOptionRow(
    '--pid [pid]',
    'Attach by PID, or open the interactive picker if no pid is given',
  ),
  formatOptionRow('--inspect-url <url>', 'Attach to an existing inspector WebSocket URL'),
])}

${formatSection('Memory kind options', [
  formatOptionRow(
    '--heap-sample-interval <size>',
    'V8 heap sampling interval (bytes or KiB/MiB)',
    'default 512KiB',
  ),
  formatOptionRow(
    '--memory-usage-interval <ms>',
    'process.memoryUsage() cadence in ms',
    'default 250',
  ),
  formatOptionRow('--include-memory-samples', 'Include raw process.memoryUsage() samples in JSON'),
  formatOptionRow(
    '--heap-snapshot-analysis',
    'Capture start/end heap snapshots and summarize retained growth',
    'heavy',
  ),
  formatOptionRow(
    '--heap-snapshot-dir <dir>',
    'Directory for .heapsnapshot files',
    'default .lanterna-heapsnapshots',
  ),
])}

${formatSection('Meta', [
  formatOptionRow('-v, --version', 'Print the Lanterna version'),
  formatOptionRow('-h, --help', 'Show this help'),
])}

${formatExamples('Examples', [
  {
    comment: 'Read an existing report in terminal-friendly form',
    cmd: 'lanterna report report.json --format text',
  },
  {
    comment: 'Run a fresh process under the profiler',
    cmd: 'lanterna run --duration 30s --output report.json -- node app.js',
  },
  {
    comment: 'Run with deopt tracing',
    cmd: 'lanterna run --deep --duration 15s -- node server.js',
  },
  {
    comment: 'Attach with an explicit profile kind',
    cmd: 'lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --kind cpu --duration 15s',
  },
  {
    comment: 'Attach directly by PID',
    cmd: 'lanterna attach --pid 4242 --duration 15s --output report.json',
  },
  {
    comment: 'Profile a ready server under HTTP load',
    cmd: 'lanterna run --duration 30s --wait-for-url http://127.0.0.1:3000/health --workload "npx -y autocannon http://127.0.0.1:3000" -- node server.js',
  },
  { comment: 'Attach until you stop it manually', cmd: 'lanterna attach --pid 4242' },
  { comment: 'Open the interactive picker', cmd: 'lanterna attach --pid' },
])}

${formatFooterHint('Run `lanterna <command> --help` for command-specific options.')}
`;

const RUN_HELP = `${renderCommandHeader({
  command: 'run',
  subtitle: 'Fresh process capture',
})}

${formatSection('Usage', [
  `  ${chalk.cyan('lanterna run')} ${chalk.gray('[options] -- <command> [args...]')}`,
])}

${formatSection('Capture', captureRunRows)}

${formatSection('Memory kind', memoryOptionRows)}

${formatSection('Output', outputRows)}

${formatSection('Plugins', pluginRows)}

${formatSection('General', generalRows)}

${formatExamples('Examples', [
  {
    comment: 'Profile a server for 15 seconds',
    cmd: 'lanterna run --duration 15s --output report.json -- node server.js',
  },
  { comment: 'Enable deopt tracing', cmd: 'lanterna run --deep --duration 15s -- node server.js' },
  { comment: 'Pretty-print JSON to stdout', cmd: 'lanterna run --pretty -- node script.js' },
  {
    comment: 'Render markdown directly from a capture',
    cmd: 'lanterna run --format markdown --output report.md -- node script.js',
  },
  {
    comment: 'Wait for a server and run autocannon during capture',
    cmd: 'lanterna run --duration 30s --wait-for-url http://127.0.0.1:3000/health --workload "npx -y autocannon http://127.0.0.1:3000" -- node server.js',
  },
  {
    comment: 'Load a detector plugin',
    cmd: 'lanterna run --detectors @acme/lanterna-detectors-prisma -- node app.js',
  },
  {
    comment: 'Memory profile only',
    cmd: 'lanterna run --kind memory --duration 30s -- node server.js',
  },
  {
    comment: 'CPU and memory together',
    cmd: 'lanterna run --kind cpu,memory --duration 30s -- node server.js',
  },
])}

${formatNotes('Notes', [
  `The ${chalk.cyan('--')} separator is required before the target command`,
  `Without ${chalk.cyan('--duration')}, Lanterna profiles until the child exits`,
  `${chalk.cyan('--kind')} works on ${chalk.cyan('run')} and ${chalk.cyan('attach')}; repeat it or use ${chalk.cyan('--kind cpu,memory')}`,
  `Use ${chalk.cyan('--workload "npx -y autocannon ..."')} to generate representative traffic while the capture is running`,
  `Built-in profile kinds: ${chalk.cyan('cpu')} (default) and ${chalk.cyan('memory')}; unknown ids fail with ${chalk.gray('"unknown profile kind(s): <ids>. Available kinds: cpu, memory"')}`,
])}
`;

const ATTACH_HELP = `${renderCommandHeader({
  command: 'attach',
  subtitle: 'Live process capture',
})}

${formatSection('Usage', [`  ${chalk.cyan('lanterna attach')} ${chalk.gray('[options]')}`])}

${formatSection('Capture', captureAttachRows)}

${formatSection('Memory kind', memoryOptionRows)}

${formatSection('Output', outputRows)}

${formatSection('Plugins', pluginRows)}

${formatSection('General', generalRows)}

${formatExamples('Examples', [
  { comment: 'Attach by PID for 15 seconds', cmd: 'lanterna attach --pid 4242 --duration 15s' },
  {
    comment: 'Attach via inspector URL',
    cmd: 'lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --kind cpu --duration 15s',
  },
  {
    comment: 'Memory profile of a live process',
    cmd: 'lanterna attach --pid 4242 --kind memory --duration 30s',
  },
  { comment: 'Attach until you stop it manually', cmd: 'lanterna attach --pid 4242' },
  { comment: 'Open the interactive picker', cmd: 'lanterna attach --pid' },
])}

${formatNotes('Notes', [
  `Without ${chalk.cyan('--duration')}, Lanterna runs until the target exits or you press ${chalk.cyan('Ctrl+C')}`,
  `${chalk.cyan('--pid')} with no value opens the interactive picker in a TTY`,
  `${chalk.cyan('--deep')} is not supported in attach mode`,
  `${chalk.cyan('--kind')} works on ${chalk.cyan('run')} and ${chalk.cyan('attach')}; repeat it or use ${chalk.cyan('--kind cpu,memory')}`,
  `Built-in profile kinds: ${chalk.cyan('cpu')} (default) and ${chalk.cyan('memory')}; unknown ids fail with ${chalk.gray('"unknown profile kind(s): <ids>. Available kinds: cpu, memory"')}`,
])}
`;

const REPORT_HELP = `${renderCommandHeader({
  command: 'report',
  subtitle: 'Existing report renderer',
})}

${formatSection('Usage', [`  ${chalk.cyan('lanterna report')} ${chalk.gray('<file> [options]')}`])}

${formatSection('Output', outputRows)}

${formatSection('General', generalRows)}

${formatExamples('Examples', [
  { comment: 'Read a report in the terminal', cmd: 'lanterna report report.json --format text' },
  {
    comment: 'Create markdown for an issue or pull request',
    cmd: 'lanterna report report.json --format markdown --output report.md',
  },
  { comment: 'Reformat JSON', cmd: 'lanterna report report.json --format json --pretty' },
])}
`;

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(GLOBAL_HELP);
    return;
  }

  if (argv[0] === '-v' || argv[0] === '--version') {
    process.stdout.write(
      `${chalk.bold.cyan('lanterna')} ${chalk.gray('v')}${chalk.bold(VERSION)}\n`,
    );
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
    try {
      await attachCommand(parseAttachArgs(rest));
    } catch (error) {
      if (error instanceof AttachSelectionCancelledError) {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    return;
  }
  if (subcommand === 'report') {
    if (rest.length === 0 || rest[0] === '-h' || rest[0] === '--help') {
      process.stdout.write(REPORT_HELP);
      return;
    }
    await reportCommand(parseReportArgs(rest));
    return;
  }

  process.stderr.write(formatUnknownCommandError(subcommand ?? ''));
  process.exitCode = 2;
}

export { ATTACH_HELP, GLOBAL_HELP, REPORT_HELP, RUN_HELP, VERSION };
