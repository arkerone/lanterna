import { type ChildProcess, spawn } from 'node:child_process';

export interface RunOrchestrationOptions {
  waitForUrl?: string;
  waitTimeoutMs?: number;
  captureDelayMs?: number;
  workload?: string;
}

export interface RunOrchestrationHooks {
  beforeCaptureStart?: () => Promise<void>;
  onCaptureStarted?: () => void;
  afterReportWritten: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export function createRunOrchestration(
  options: RunOrchestrationOptions,
  onProgressMessage: (message: string) => void,
): RunOrchestrationHooks {
  const workload = options.workload ? createWorkloadController(options.workload) : undefined;
  return {
    beforeCaptureStart:
      options.waitForUrl || options.captureDelayMs !== undefined
        ? async () => {
            if (options.waitForUrl) {
              const timeoutMs = options.waitTimeoutMs ?? 30_000;
              onProgressMessage(`Waiting for ${options.waitForUrl} to become ready...`);
              await waitForUrl(options.waitForUrl, timeoutMs);
            }
            if (options.captureDelayMs !== undefined && options.captureDelayMs > 0) {
              onProgressMessage(
                `Waiting ${Math.round(options.captureDelayMs)}ms before capture...`,
              );
              await sleep(options.captureDelayMs);
            }
          }
        : undefined,
    onCaptureStarted: workload
      ? () => {
          onProgressMessage(`Starting workload: ${options.workload}`);
          workload.start();
        }
      : undefined,
    afterReportWritten: async () => {
      await workload?.finishAfterCapture();
    },
    cleanup: async () => {
      await workload?.terminateIfRunning();
    },
  };
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(1000, Math.max(100, timeoutMs))),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const suffix = lastError instanceof Error && lastError.message ? ` (${lastError.message})` : '';
  throw new Error(`timed out waiting ${timeoutMs}ms for ${url}${suffix}`);
}

function createWorkloadController(command: string): {
  start: () => void;
  finishAfterCapture: () => Promise<void>;
  terminateIfRunning: () => Promise<void>;
} {
  let child: ChildProcess | undefined;
  let settled = false;
  let killedByLanterna = false;
  let result: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;

  const terminateIfRunning = async (): Promise<void> => {
    if (!child || settled) return;
    killedByLanterna = true;
    child.kill('SIGTERM');
    await Promise.race([result, sleep(1000)]);
    if (!settled) child.kill('SIGKILL');
    await result?.catch(() => undefined);
  };

  return {
    start() {
      if (child) return;
      child = spawn(command, {
        cwd: process.cwd(),
        env: process.env,
        shell: true,
        stdio: 'inherit',
      });
      result = new Promise((resolve, reject) => {
        child?.once('error', reject);
        child?.once('exit', (code, signal) => {
          settled = true;
          resolve({ code, signal });
        });
      });
    },
    async finishAfterCapture() {
      if (!child || !result) return;
      if (!settled) {
        await terminateIfRunning();
        return;
      }
      const exit = await result;
      if (killedByLanterna) return;
      if (exit.code !== 0) {
        const exitLabel = exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`;
        throw new Error(`workload failed with ${exitLabel}`);
      }
    },
    terminateIfRunning,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
