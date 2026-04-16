import { readlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import { readInspectableTargetsByPid } from '@lanterna/core';
import chalk from 'chalk';
import Table from 'cli-table3';
import psList from 'ps-list';
import type { AttachProfileOptions } from './parse.js';

const NODE_LAUNCHERS = new Set([
  'node',
  'nodejs',
  'npm',
  'pnpm',
  'yarn',
  'tsx',
  'vite',
  'next',
  'next-dev',
  'next-start',
  'nest',
]);

export interface RunningNodeProcess {
  pid: number;
  runtime: string;
  command: string;
  cwd?: string;
  age: string;
  cpu?: number;
  memory?: number;
  kind: 'app' | 'tooling';
  attachMode: 'cdp-ready' | 'pid-attach';
}

export type RunningNodeProcessCandidate = Omit<RunningNodeProcess, 'attachMode'>;

export async function resolveAttachTarget(
  options: AttachProfileOptions,
): Promise<AttachProfileOptions> {
  if (!shouldPromptForTarget(options)) {
    return options;
  }

  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      '`lanterna attach` requires --pid or --inspect-url when not running in an interactive terminal',
    );
  }

  const processes = await listRunningNodeProcesses();
  if (processes.length === 0) {
    throw new Error(
      'no attachable Node.js app processes found. Use --pid, --inspect-url, or `lanterna run -- <command>`',
    );
  }

  intro(chalk.cyanBright('Lanterna Attach'), { output: process.stderr });
  log.step('Select a running Node.js process to profile.', { output: process.stderr });
  process.stderr.write(`${renderProcessTable(processes)}\n`);
  process.stderr.write(
    `${chalk.gray('* PID attach = best effort via SIGUSR1 on a live, signalable process')}\n`,
  );

  const selection = await select({
    message: 'Which running program should Lanterna attach to?',
    input: process.stdin,
    output: process.stderr,
    options: processes.map((processEntry) => ({
      value: processEntry.pid,
      label: buildProcessLabel(processEntry),
      hint: buildProcessHint(processEntry),
    })),
    maxItems: 12,
  });

  if (isCancel(selection)) {
    cancel('Attach canceled.', { output: process.stderr });
    process.exitCode = 1;
    process.exit(1);
  }

  const selectedProcess = processes.find((entry) => entry.pid === selection);
  outro(`Attaching to ${selectedProcess?.pid ?? selection}`, { output: process.stderr });

  return {
    ...options,
    pid: selection,
    promptForTarget: false,
  };
}

function shouldPromptForTarget(options: AttachProfileOptions): boolean {
  if (options.inspectUrl !== undefined) return false;
  if (options.pid !== undefined) return false;
  return options.promptForTarget === true;
}

async function listRunningNodeProcesses(): Promise<RunningNodeProcess[]> {
  const processes = await psList({ all: false });
  const inspectorTargetsByPid = await readInspectableTargetsByPid();

  const candidates: RunningNodeProcessCandidate[] = await Promise.all(
    processes
      .filter((entry) => entry.pid !== process.pid)
      .filter((entry) => isLikelyNodeProcess(entry.name, entry.cmd, entry.path))
      .filter((entry) => !(entry.cmd ?? '').includes('bin/lanterna.js'))
      .map(async (entry) => ({
        pid: entry.pid,
        runtime: normalizeRuntime(entry.path ?? entry.name),
        command: (entry.cmd ?? entry.name).trim(),
        cwd: await readProcessCwd(entry.pid),
        age: formatAge(entry.startTime),
        cpu: entry.cpu,
        memory: entry.memory,
        kind: classifyProcess(entry.cmd ?? entry.name),
      })),
  );

  const attachableCandidates = candidates.map<RunningNodeProcess | undefined>((entry) => {
    const existingInspector = inspectorTargetsByPid.get(entry.pid);
    const attachMode = classifyAttachMode(
      entry,
      Boolean(existingInspector?.webSocketDebuggerUrl),
      canAttemptPidAttach(entry),
    );
    if (attachMode !== undefined) {
      return {
        ...entry,
        attachMode,
      };
    }

    return undefined;
  });

  const readyCandidates = attachableCandidates.filter(isAttachableAppProcess);

  return readyCandidates.sort((left, right) => {
    const modeDelta = rankAttachMode(left.attachMode) - rankAttachMode(right.attachMode);
    if (modeDelta !== 0) return modeDelta;
    const cpuDelta = (right.cpu ?? 0) - (left.cpu ?? 0);
    if (cpuDelta !== 0) return cpuDelta;
    return left.pid - right.pid;
  });
}

function isLikelyNodeProcess(
  name: string,
  command: string | undefined,
  path: string | undefined,
): boolean {
  const runtime = normalizeRuntime(path ?? name);
  if (NODE_LAUNCHERS.has(runtime)) return true;

  const cmd = command ?? '';
  return (
    runtime === 'cursor' &&
    (cmd.includes('--node-ipc') ||
      cmd.includes('node.mojom.NodeService') ||
      cmd.includes('/resources/helpers/node '))
  );
}

function normalizeRuntime(value: string): string {
  const parts = value.split('/');
  return (parts[parts.length - 1] ?? value).trim();
}

function classifyProcess(command: string): 'app' | 'tooling' {
  const toolingMarkers = [
    '--node-ipc',
    '--stdio',
    '--type=utility',
    'node.mojom.NodeService',
    'typingsInstaller.js',
    'language-server',
    'eslintServer',
    'tsserver',
    'serverMain.js',
    'jsonServerMain',
    'extension',
    'clientProcessId=',
  ];
  return toolingMarkers.some((marker) => command.includes(marker)) ? 'tooling' : 'app';
}

function canAttemptPidAttach(processEntry: RunningNodeProcessCandidate): boolean {
  if (process.platform === 'win32') return false;
  if (processEntry.kind !== 'app') return false;
  return isProcessSignalable(processEntry.pid);
}

export function classifyAttachMode(
  processEntry: RunningNodeProcessCandidate,
  hasInspectorTarget: boolean,
  canAttachByPid: boolean,
): RunningNodeProcess['attachMode'] | undefined {
  if (hasInspectorTarget) return 'cdp-ready';
  if (canAttachByPid && processEntry.kind === 'app') return 'pid-attach';
  return undefined;
}

export function isAttachableAppProcess(
  entry: RunningNodeProcess | undefined,
): entry is RunningNodeProcess {
  return entry !== undefined && entry.kind === 'app';
}

function rankAttachMode(mode: RunningNodeProcess['attachMode']): number {
  return mode === 'cdp-ready' ? 0 : 1;
}

function isProcessSignalable(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessCwd(pid: number): Promise<string | undefined> {
  if (process.platform !== 'linux') return undefined;
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return undefined;
  }
}

function renderProcessTable(processes: RunningNodeProcess[]): string {
  const table = new Table({
    head: [
      chalk.bold('PID'),
      chalk.bold('Age'),
      chalk.bold('CPU'),
      chalk.bold('Mem'),
      chalk.bold('Attach'),
      chalk.bold('Runtime'),
      chalk.bold('CWD'),
      chalk.bold('Command'),
    ],
    style: {
      head: [],
      border: ['gray'],
      compact: true,
    },
    colWidths: [8, 10, 8, 8, 14, 12, 26, 56],
    wordWrap: true,
  });

  for (const processEntry of processes) {
    table.push([
      chalk.cyan(String(processEntry.pid)),
      chalk.gray(processEntry.age),
      formatPct(processEntry.cpu),
      formatPct(processEntry.memory),
      formatAttachMode(processEntry.attachMode),
      chalk.yellow(processEntry.runtime),
      formatCwd(processEntry.cwd),
      truncateCommand(processEntry.command, 52),
    ]);
  }

  return table.toString();
}

function buildProcessLabel(processEntry: RunningNodeProcess): string {
  return `${processEntry.pid} · ${formatAttachModePlain(processEntry.attachMode)} · ${processEntry.runtime} · ${processEntry.age} · ${formatCwdPlain(processEntry.cwd)}`;
}

function buildProcessHint(processEntry: RunningNodeProcess): string {
  const metrics = [formatPctPlain(processEntry.cpu), formatPctPlain(processEntry.memory)]
    .filter(Boolean)
    .join(' CPU / MEM ');
  const command = truncateCommand(processEntry.command, 72);
  return metrics.length > 0 ? `${metrics} · ${command}` : command;
}

function formatAge(startTime: Date | undefined): string {
  if (!startTime) return 'unknown';
  const elapsedMs = Math.max(0, Date.now() - startTime.getTime());
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}`;
  return `${seconds}s`;
}

function formatPct(value: number | undefined): string {
  return value === undefined ? chalk.gray('—') : chalk.magenta(`${value.toFixed(1)}%`);
}

function formatPctPlain(value: number | undefined): string {
  return value === undefined ? '' : `${value.toFixed(1)}%`;
}

function formatAttachMode(mode: RunningNodeProcess['attachMode']): string {
  return mode === 'cdp-ready' ? chalk.green('CDP ready') : chalk.blue('PID attach*');
}

function formatAttachModePlain(mode: RunningNodeProcess['attachMode']): string {
  return mode === 'cdp-ready' ? 'CDP ready' : 'PID attach*';
}

function formatCwd(cwd: string | undefined): string {
  if (!cwd) return chalk.gray('(unknown)');
  return basename(cwd) || cwd;
}

function formatCwdPlain(cwd: string | undefined): string {
  if (!cwd) return '(unknown)';
  return basename(cwd) || cwd;
}

function truncateCommand(command: string, maxLength: number): string {
  if (command.length <= maxLength) return command;
  return `${command.slice(0, Math.max(0, maxLength - 1))}…`;
}
