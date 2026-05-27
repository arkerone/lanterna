import { basename } from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { RunningNodeProcess } from './node-process-discovery.js';

/** Colored table of discovered Node.js processes, shared by the picker and `lanterna ps`. */
export function renderProcessTable(processes: readonly RunningNodeProcess[]): string {
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
      chalk.gray(formatAge(processEntry.ageMs)),
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

export function formatAge(ageMs: number | undefined): string {
  if (ageMs === undefined) return 'unknown';
  const totalSeconds = Math.floor(ageMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}`;
  return `${seconds}s`;
}

export function truncateCommand(command: string, maxLength: number): string {
  if (command.length <= maxLength) return command;
  return `${command.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatPct(value: number | undefined): string {
  return value === undefined ? chalk.gray('—') : chalk.magenta(`${value.toFixed(1)}%`);
}

function formatAttachMode(mode: RunningNodeProcess['attachMode']): string {
  return mode === 'cdp-ready' ? chalk.green('CDP ready') : chalk.blue('PID attach*');
}

function formatCwd(cwd: string | undefined): string {
  if (!cwd) return chalk.gray('(unknown)');
  return basename(cwd) || cwd;
}
