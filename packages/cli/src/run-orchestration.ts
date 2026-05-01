import { type ChildProcess, spawn } from 'node:child_process';
import { sleep } from '@lanterna-profiler/core';

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
  const readinessWaiter = createReadinessWaiter(options, onProgressMessage);
  const captureDelay = createCaptureDelay(options, onProgressMessage);
  const workload = createWorkloadRunner(options, onProgressMessage);

  return {
    beforeCaptureStart: async () => {
      await readinessWaiter.wait();
      await captureDelay.wait();
    },
    onCaptureStarted: () => {
      workload.start();
    },
    afterReportWritten: async () => {
      await workload.finishAfterCapture();
    },
    cleanup: async () => {
      await workload.terminateIfRunning();
    },
  };
}

interface ReadinessWaiter {
  wait: () => Promise<void>;
}

function createReadinessWaiter(
  options: RunOrchestrationOptions,
  onProgressMessage: (message: string) => void,
): ReadinessWaiter {
  if (!options.waitForUrl) return new NoopReadinessWaiter();
  return new UrlReadinessWaiter(
    options.waitForUrl,
    options.waitTimeoutMs ?? 30_000,
    onProgressMessage,
  );
}

class NoopReadinessWaiter implements ReadinessWaiter {
  wait(): Promise<void> {
    return Promise.resolve();
  }
}

class UrlReadinessWaiter implements ReadinessWaiter {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
    private readonly onProgressMessage: (message: string) => void,
  ) {}

  async wait(): Promise<void> {
    this.onProgressMessage(`Waiting for ${this.url} to become ready...`);
    await waitForUrl(this.url, this.timeoutMs);
  }
}

interface CaptureDelay {
  wait: () => Promise<void>;
}

function createCaptureDelay(
  options: RunOrchestrationOptions,
  onProgressMessage: (message: string) => void,
): CaptureDelay {
  if (options.captureDelayMs === undefined || options.captureDelayMs <= 0) {
    return new NoopCaptureDelay();
  }
  return new TimedCaptureDelay(options.captureDelayMs, onProgressMessage);
}

class NoopCaptureDelay implements CaptureDelay {
  wait(): Promise<void> {
    return Promise.resolve();
  }
}

class TimedCaptureDelay implements CaptureDelay {
  constructor(
    private readonly delayMs: number,
    private readonly onProgressMessage: (message: string) => void,
  ) {}

  async wait(): Promise<void> {
    this.onProgressMessage(`Waiting ${Math.round(this.delayMs)}ms before capture...`);
    await sleep(this.delayMs);
  }
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
  const suffix = formatLastReadinessError(lastError);
  throw new Error(`timed out waiting ${timeoutMs}ms for ${url}${suffix}`);
}

function formatLastReadinessError(lastError: unknown): string {
  if (!(lastError instanceof Error)) return '';
  if (!lastError.message) return '';
  return ` (${lastError.message})`;
}

interface WorkloadRunner {
  start: () => void;
  finishAfterCapture: () => Promise<void>;
  terminateIfRunning: () => Promise<void>;
}

function createWorkloadRunner(
  options: RunOrchestrationOptions,
  onProgressMessage: (message: string) => void,
): WorkloadRunner {
  if (!options.workload) return new NoopWorkloadRunner();
  return new ShellWorkloadRunner(options.workload, onProgressMessage);
}

class NoopWorkloadRunner implements WorkloadRunner {
  start(): void {}

  finishAfterCapture(): Promise<void> {
    return Promise.resolve();
  }

  terminateIfRunning(): Promise<void> {
    return Promise.resolve();
  }
}

class ShellWorkloadRunner implements WorkloadRunner {
  private child: ChildProcess | undefined;
  private settled = false;
  private killedByLanterna = false;
  private result: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;

  constructor(
    private readonly command: string,
    private readonly onProgressMessage: (message: string) => void,
  ) {}

  start(): void {
    if (this.child) return;
    this.onProgressMessage(`Starting workload: ${this.command}`);
    this.child = spawn(this.command, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: 'inherit',
    });
    this.result = new Promise((resolve, reject) => {
      this.child?.once('error', reject);
      this.child?.once('exit', (code, signal) => {
        this.settled = true;
        resolve({ code, signal });
      });
    });
  }

  async finishAfterCapture(): Promise<void> {
    if (!this.child || !this.result) return;
    if (!this.settled) {
      await this.terminateIfRunning();
      return;
    }
    const exit = await this.result;
    if (this.killedByLanterna) return;
    if (exit.code !== 0) {
      throw new Error(`workload failed with ${formatWorkloadExit(exit)}`);
    }
  }

  async terminateIfRunning(): Promise<void> {
    if (!this.child || this.settled) return;
    this.killedByLanterna = true;
    this.child.kill('SIGTERM');
    await Promise.race([this.result, sleep(1000)]);
    if (!this.settled) this.child.kill('SIGKILL');
    await this.result?.catch(() => undefined);
  }
}

function formatWorkloadExit(exit: { code: number | null; signal: NodeJS.Signals | null }): string {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code}`;
}
