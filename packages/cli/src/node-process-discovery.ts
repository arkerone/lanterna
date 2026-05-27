import { readlink } from 'node:fs/promises';
import { readInspectableTargetsByPid } from '@lanterna-profiler/core';
import psList from 'ps-list';

const DIRECT_NODE_RUNTIMES = new Set(['node', 'nodejs']);

export interface RunningNodeProcess {
  pid: number;
  runtime: string;
  command: string;
  cwd?: string;
  /** Milliseconds since the process started, or undefined when unknown. */
  ageMs?: number;
  cpu?: number;
  memory?: number;
  attachMode: 'cdp-ready' | 'pid-attach';
}

type DiscoveredNodeProcess = Omit<RunningNodeProcess, 'attachMode'>;

/**
 * Discovers running Node.js processes Lanterna can attach to. Returns only
 * attachable direct Node.js runtime targets (CDP-ready or SIGUSR1-signalable), sorted with
 * CDP-ready first, then by CPU, then pid. This is the headless, render-free
 * counterpart consumed by both the interactive picker and `lanterna ps`.
 */
export async function listRunningNodeProcesses(): Promise<RunningNodeProcess[]> {
  const [processes, inspectorTargetsByPid] = await Promise.all([
    psList({ all: false }),
    readInspectableTargetsByPid(),
  ]);

  const discoveredProcesses: DiscoveredNodeProcess[] = await Promise.all(
    processes
      .filter((entry) => entry.pid !== process.pid)
      .filter((entry) => isProcessRunning(entry.pid))
      .filter((entry) => hasDirectNodeRuntime(entry.name, entry.path))
      .map(async (entry) => {
        const runtime = normalizeRuntime(entry.path ?? entry.name);
        const command = (entry.cmd ?? entry.name).trim();
        return {
          pid: entry.pid,
          runtime,
          command,
          cwd: await readProcessCwd(entry.pid),
          ageMs: computeAgeMs(entry.startTime),
          cpu: entry.cpu,
          memory: entry.memory,
        };
      }),
  );

  const attachableProcesses = discoveredProcesses.flatMap<RunningNodeProcess>((entry) => {
    const existingInspector = inspectorTargetsByPid.get(entry.pid);
    const attachMode = classifyAttachMode(
      Boolean(existingInspector?.webSocketDebuggerUrl),
      canAttemptPidAttach(entry.pid),
    );
    if (attachMode !== undefined) {
      return [
        {
          ...entry,
          attachMode,
        },
      ];
    }

    return [];
  });

  return attachableProcesses.sort(compareRunningNodeProcesses);
}

function hasDirectNodeRuntime(name: string, path: string | undefined): boolean {
  const runtime = normalizeRuntime(path ?? name).toLowerCase();
  return DIRECT_NODE_RUNTIMES.has(runtime);
}

function normalizeRuntime(value: string): string {
  const parts = value.split('/');
  return (parts[parts.length - 1] ?? value).trim();
}

function canAttemptPidAttach(pid: number): boolean {
  if (process.platform === 'win32') return false;
  return isProcessRunning(pid);
}

export function classifyAttachMode(
  hasInspectorTarget: boolean,
  canAttachByPid: boolean,
): RunningNodeProcess['attachMode'] | undefined {
  if (hasInspectorTarget) return 'cdp-ready';
  if (canAttachByPid) return 'pid-attach';
  return undefined;
}

function compareRunningNodeProcesses(left: RunningNodeProcess, right: RunningNodeProcess): number {
  const modeDelta = rankAttachMode(left.attachMode) - rankAttachMode(right.attachMode);
  if (modeDelta !== 0) return modeDelta;
  const cpuDelta = (right.cpu ?? 0) - (left.cpu ?? 0);
  if (cpuDelta !== 0) return cpuDelta;
  return left.pid - right.pid;
}

function rankAttachMode(mode: RunningNodeProcess['attachMode']): number {
  return mode === 'cdp-ready' ? 0 : 1;
}

function isProcessRunning(pid: number): boolean {
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

function computeAgeMs(startTime: Date | undefined): number | undefined {
  if (!startTime) return undefined;
  return Math.max(0, Date.now() - startTime.getTime());
}
