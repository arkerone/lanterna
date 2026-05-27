import { basename } from 'node:path';
import { cancel, intro, isCancel, log, outro, select } from '@clack/prompts';
import chalk from 'chalk';
import { listRunningNodeProcesses, type RunningNodeProcess } from './node-process-discovery.js';
import { formatAge, renderProcessTable, truncateCommand } from './node-process-table.js';
import type { AttachProfileOptions } from './parse.js';
import { renderCommandHeader } from './terminal-style.js';

export type { RunningNodeProcess } from './node-process-discovery.js';
export {
  classifyAttachMode,
  listRunningNodeProcesses,
} from './node-process-discovery.js';

export class AttachSelectionCancelledError extends Error {
  constructor() {
    super('attach canceled');
    this.name = 'AttachSelectionCancelledError';
  }
}

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
      'no attachable node/nodejs runtimes found. Use --pid, --inspect-url, or `lanterna run -- <command>`',
    );
  }

  intro(
    renderCommandHeader({
      command: 'attach',
      subtitle: 'Pick a running Node.js process',
    }),
    { output: process.stderr },
  );
  log.step('Select a running Node.js process to profile.', { output: process.stderr });
  process.stderr.write(`${renderProcessTable(processes)}\n`);
  process.stderr.write(
    `${chalk.gray('* PID attach = best effort via SIGUSR1 on a live, signalable process')}\n`,
  );
  process.stderr.write(`${chalk.gray('  Use ↑/↓ to move · Enter to attach · Ctrl+C to cancel')}\n`);

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
    throw new AttachSelectionCancelledError();
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

function buildProcessLabel(processEntry: RunningNodeProcess): string {
  return `${processEntry.pid} · ${formatAttachModePlain(processEntry.attachMode)} · ${processEntry.runtime} · ${formatAge(processEntry.ageMs)} · ${formatCwdPlain(processEntry.cwd)}`;
}

function buildProcessHint(processEntry: RunningNodeProcess): string {
  const metrics = [formatPctPlain(processEntry.cpu), formatPctPlain(processEntry.memory)]
    .filter(Boolean)
    .join(' CPU / MEM ');
  const command = truncateCommand(processEntry.command, 72);
  return metrics.length > 0 ? `${metrics} · ${command}` : command;
}

function formatPctPlain(value: number | undefined): string {
  return value === undefined ? '' : `${value.toFixed(1)}%`;
}

function formatAttachModePlain(mode: RunningNodeProcess['attachMode']): string {
  return mode === 'cdp-ready' ? 'CDP ready' : 'PID attach*';
}

function formatCwdPlain(cwd: string | undefined): string {
  if (!cwd) return '(unknown)';
  return basename(cwd) || cwd;
}
