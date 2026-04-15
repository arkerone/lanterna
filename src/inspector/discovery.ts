import { z } from 'zod';
import { connectCdp } from './client.js';
import { fetchTargetInfo } from './runtime.js';
import { sleep } from '../shared/sleep.js';

const INSPECTOR_DISCOVERY_TIMEOUT_MS = 5_000;
const INSPECTOR_DISCOVERY_INTERVAL_MS = 100;
const DEFAULT_INSPECTOR_DISCOVERY_PORT = 9229;
const INSPECTOR_DISCOVERY_PORT_RANGE = 10;

const inspectorTargetSchema = z.object({
  id: z.string().optional(),
  webSocketDebuggerUrl: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
});

export interface InspectorTargetDescriptor {
  id?: string;
  webSocketDebuggerUrl?: string;
  title?: string;
  type?: string;
  url?: string;
}

export async function openInspectorForPid(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid --pid: ${pid}`);
  }
  if (process.platform === 'win32') {
    throw new Error('`lanterna attach --pid` is not supported on Windows; use --inspect-url instead');
  }

  const existingTargets = await readInspectorTargets();
  const existingTarget = await findInspectorTargetByPid(existingTargets, pid);
  if (existingTarget?.webSocketDebuggerUrl) {
    return existingTarget.webSocketDebuggerUrl;
  }

  try {
    process.kill(pid, 'SIGUSR1');
  } catch (error) {
    throw new Error(`failed to signal pid ${pid} with SIGUSR1: ${(error as Error).message}`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < INSPECTOR_DISCOVERY_TIMEOUT_MS) {
    const targets = await readInspectorTargets();
    const target = await findInspectorTargetByPid(targets, pid);
    if (target?.webSocketDebuggerUrl) {
      return target.webSocketDebuggerUrl;
    }
    await sleep(INSPECTOR_DISCOVERY_INTERVAL_MS);
  }

  throw new Error(
    `timed out waiting for inspector on pid ${pid}. `
    + 'Ensure the process is Node.js and that port 9229 is available, or pass --inspect-url.',
  );
}

export async function readInspectorTargets(): Promise<InspectorTargetDescriptor[]> {
  const allTargets: InspectorTargetDescriptor[] = [];
  for (let port = DEFAULT_INSPECTOR_DISCOVERY_PORT; port < DEFAULT_INSPECTOR_DISCOVERY_PORT + INSPECTOR_DISCOVERY_PORT_RANGE; port += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) continue;
      const value = await response.json() as unknown;
      const parsed = inspectorTargetSchema.array().safeParse(value);
      if (parsed.success) {
        allTargets.push(...parsed.data);
      }
    } catch {
      // Ignore ports with no inspector listener.
    }
  }
  return allTargets;
}

async function findInspectorTargetByPid(
  targets: InspectorTargetDescriptor[],
  pid: number,
): Promise<InspectorTargetDescriptor | undefined> {
  for (const target of targets) {
    const webSocketDebuggerUrl = target.webSocketDebuggerUrl;
    if (!webSocketDebuggerUrl) continue;
    if (await inspectorUrlMatchesPid(webSocketDebuggerUrl, pid)) {
      return target;
    }
  }
  return undefined;
}

async function inspectorUrlMatchesPid(
  webSocketDebuggerUrl: string,
  pid: number,
): Promise<boolean> {
  let cdp;
  try {
    cdp = await connectCdp(webSocketDebuggerUrl);
    const targetInfo = await fetchTargetInfo(cdp);
    return targetInfo.pid === pid;
  } catch {
    return false;
  } finally {
    await cdp?.close().catch(() => {});
  }
}
