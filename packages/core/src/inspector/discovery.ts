import { z } from 'zod';
import { sleep } from '../shared/sleep.js';
import { connectCdp } from './client.js';
import { fetchTargetInfo } from './runtime.js';

const INSPECTOR_DISCOVERY_TIMEOUT_MS = 5_000;
const INSPECTOR_DISCOVERY_INTERVAL_MS = 100;
const INSPECTOR_DISCOVERY_FETCH_TIMEOUT_MS = 250;
const INSPECTOR_DISCOVERY_CDP_TIMEOUT_MS = 250;
const DEFAULT_INSPECTOR_DISCOVERY_PORT = 9229;
const INSPECTOR_DISCOVERY_PORT_RANGE = 10;
const INSPECTOR_DISCOVERY_PORT_END =
  DEFAULT_INSPECTOR_DISCOVERY_PORT + INSPECTOR_DISCOVERY_PORT_RANGE - 1;

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

export async function openInspectorForPid(
  pid: number,
  onProgress?: (message: string) => void,
): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid --pid: ${pid}`);
  }
  if (process.platform === 'win32') {
    throw new Error(
      '`lanterna attach --pid` is not supported on Windows; use --inspect-url instead',
    );
  }

  onProgress?.(`Checking whether pid ${pid} already exposes a CDP inspector endpoint...`);
  const existingTargets = await readInspectorTargets();
  const existingTarget = await findInspectorTargetByPid(existingTargets, pid);
  if (existingTarget?.webSocketDebuggerUrl) {
    onProgress?.(`Found an existing CDP inspector endpoint for pid ${pid}.`);
    return existingTarget.webSocketDebuggerUrl;
  }

  onProgress?.(
    `No inspector endpoint found in the default scan range for pid ${pid}. Requesting Node to open one via SIGUSR1...`,
  );
  try {
    process.kill(pid, 'SIGUSR1');
  } catch (error) {
    throw new Error(`failed to signal pid ${pid} with SIGUSR1: ${(error as Error).message}`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < INSPECTOR_DISCOVERY_TIMEOUT_MS) {
    onProgress?.(`Waiting for pid ${pid} to expose its CDP inspector endpoint...`);
    const targets = await readInspectorTargets();
    const target = await findInspectorTargetByPid(targets, pid);
    if (target?.webSocketDebuggerUrl) {
      onProgress?.(`Inspector endpoint is ready for pid ${pid}.`);
      return target.webSocketDebuggerUrl;
    }
    await sleep(INSPECTOR_DISCOVERY_INTERVAL_MS);
  }

  throw new Error(
    `timed out waiting for inspector on pid ${pid}. ` +
      `Ensure the process is Node.js and that an inspector can bind within ${DEFAULT_INSPECTOR_DISCOVERY_PORT}-${INSPECTOR_DISCOVERY_PORT_END}, or pass --inspect-url.`,
  );
}

export async function findExistingInspectorTargetByPid(
  pid: number,
): Promise<InspectorTargetDescriptor | undefined> {
  const targets = await readInspectorTargets();
  return findInspectorTargetByPid(targets, pid);
}

export async function readInspectableTargetsByPid(): Promise<
  Map<number, InspectorTargetDescriptor>
> {
  const targets = await readInspectorTargets();
  const targetsByPid = new Map<number, InspectorTargetDescriptor>();

  for (const target of targets) {
    const webSocketDebuggerUrl = target.webSocketDebuggerUrl;
    if (!webSocketDebuggerUrl) continue;

    const targetPid = await readPidForInspectorUrl(webSocketDebuggerUrl);
    if (targetPid !== undefined) {
      targetsByPid.set(targetPid, target);
    }
  }

  return targetsByPid;
}

export async function readInspectorTargets(): Promise<InspectorTargetDescriptor[]> {
  const allTargets: InspectorTargetDescriptor[] = [];
  for (
    let port = DEFAULT_INSPECTOR_DISCOVERY_PORT;
    port < DEFAULT_INSPECTOR_DISCOVERY_PORT + INSPECTOR_DISCOVERY_PORT_RANGE;
    port += 1
  ) {
    try {
      const response = await fetchWithTimeout(
        `http://127.0.0.1:${port}/json/list`,
        INSPECTOR_DISCOVERY_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const value = (await response.json()) as unknown;
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

async function inspectorUrlMatchesPid(webSocketDebuggerUrl: string, pid: number): Promise<boolean> {
  const targetPid = await readPidForInspectorUrl(webSocketDebuggerUrl);
  return targetPid === pid;
}

async function readPidForInspectorUrl(webSocketDebuggerUrl: string): Promise<number | undefined> {
  let cdp: Awaited<ReturnType<typeof connectCdp>> | undefined;
  try {
    cdp = await connectCdpWithTimeout(webSocketDebuggerUrl, INSPECTOR_DISCOVERY_CDP_TIMEOUT_MS);
    const targetInfo = await withTimeout(fetchTargetInfo(cdp), INSPECTOR_DISCOVERY_CDP_TIMEOUT_MS);
    return targetInfo.pid;
  } catch {
    return undefined;
  } finally {
    await cdp?.close().catch(() => {});
  }
}

async function connectCdpWithTimeout(
  webSocketDebuggerUrl: string,
  timeoutMs: number,
): ReturnType<typeof connectCdp> {
  const connectPromise = connectCdp(webSocketDebuggerUrl);
  try {
    return await withTimeout(connectPromise, timeoutMs);
  } catch (error) {
    connectPromise.then(
      (lateCdp) => {
        void lateCdp.close().catch(() => {});
      },
      () => {},
    );
    throw error;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
