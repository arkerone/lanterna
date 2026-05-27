import { listRunningNodeProcesses, type RunningNodeProcess } from '../node-process-discovery.js';
import { renderProcessTable } from '../node-process-table.js';
import type { PsFormat, PsOptions } from '../parse.js';

/** Machine-readable shape emitted by `lanterna ps --format json`. */
export interface ProcessListEntry {
  pid: number;
  runtime: string;
  attachMode: RunningNodeProcess['attachMode'];
  command: string;
  cwd?: string;
  ageMs?: number;
  cpu?: number;
  memory?: number;
}

const EMPTY_TEXT_MESSAGE = [
  'No attachable node/nodejs runtimes found.',
  'Start one with `lanterna run -- <command>`, or attach by URL with `lanterna attach --inspect-url <ws-url>`.',
].join('\n');

export function toProcessListJson(processes: readonly RunningNodeProcess[]): ProcessListEntry[] {
  return processes.map((processEntry) => {
    const entry: ProcessListEntry = {
      pid: processEntry.pid,
      runtime: processEntry.runtime,
      attachMode: processEntry.attachMode,
      command: processEntry.command,
    };
    if (processEntry.cwd !== undefined) entry.cwd = processEntry.cwd;
    if (processEntry.ageMs !== undefined) entry.ageMs = processEntry.ageMs;
    if (processEntry.cpu !== undefined) entry.cpu = processEntry.cpu;
    if (processEntry.memory !== undefined) entry.memory = processEntry.memory;
    return entry;
  });
}

export function serializeProcessList(
  processes: readonly RunningNodeProcess[],
  format: PsFormat,
  pretty: boolean,
): string {
  if (format === 'json') {
    return JSON.stringify(toProcessListJson(processes), null, pretty ? 2 : 0);
  }
  if (processes.length === 0) {
    return EMPTY_TEXT_MESSAGE;
  }
  return renderProcessTable(processes);
}

/**
 * Without an explicit `--format`, default to the colored table on an
 * interactive terminal and to JSON when stdout is piped (scripts, agents).
 */
export function resolvePsFormat(format: PsFormat | undefined): PsFormat {
  if (format !== undefined) return format;
  return process.stdout.isTTY ? 'text' : 'json';
}

export async function psCommand(options: PsOptions): Promise<void> {
  const format = resolvePsFormat(options.format);
  const processes = await listRunningNodeProcesses();
  const rendered = serializeProcessList(processes, format, options.pretty);
  process.stdout.write(`${rendered}\n`);
}
