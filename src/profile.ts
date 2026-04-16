import { analyzeCapture } from './analysis/index.js';
import { startAttachCapture } from './capture/attach.js';
import { startSpawnCapture } from './capture/spawn.js';
import type { CaptureHandle } from './capture/core/types.js';
import { buildLanternaReport } from './report/index.js';
import { sleep } from './shared/sleep.js';
import type { LanternaReport } from './report/types.js';

export interface RunProfileOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  durationMs: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros: number;
}

export async function runProfile(options: RunProfileOptions): Promise<LanternaReport> {
  const handle = await startSpawnCapture({
    command: options.command,
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
  });

  const stopReason = await waitForStopReason(handle, options.durationMs);

  const rawCapture = await handle.stop();
  const analysis = analyzeCapture(rawCapture, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
    command: options.command,
    mode: 'spawn',
  });

  const report = buildLanternaReport(rawCapture, analysis, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
    command: options.command,
    mode: 'spawn',
  });

  if (stopReason.type === 'signal') {
    process.exitCode = 0;
  }

  return report;
}

export async function attachProfile(options: AttachProfileOptions): Promise<LanternaReport> {
  const handle = await startAttachCapture({
    pid: options.pid,
    inspectUrl: options.inspectUrl,
    sampleIntervalMicros: options.sampleIntervalMicros,
  });

  const stopReason = await waitForStopReason(handle, options.durationMs);

  const rawCapture = await handle.stop();
  const analysis = analyzeCapture(rawCapture, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: false,
    command: [],
    mode: 'attach',
  });

  const report = buildLanternaReport(rawCapture, analysis, {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: false,
    command: [],
    mode: 'attach',
  });

  if (stopReason.type === 'signal') {
    process.exitCode = 0;
  }

  return report;
}

type StopReason =
  | { type: 'signal'; signal: NodeJS.Signals }
  | { type: 'timeout' }
  | { type: 'exit' };

async function waitForStopReason(
  handle: Pick<CaptureHandle, 'waitForExit'>,
  durationMs?: number,
): Promise<StopReason> {
  const manualStop = createManualStopWatcher();
  try {
    const pending = [handle.waitForExit().then<StopReason>(() => ({ type: 'exit' })), manualStop.promise];
    if (durationMs !== undefined) {
      pending.push(sleep(durationMs).then<StopReason>(() => ({ type: 'timeout' })));
    }
    return await Promise.race(pending);
  } finally {
    manualStop.dispose();
  }
}

function createManualStopWatcher(): {
  promise: Promise<StopReason>;
  dispose: () => void;
} {
  let resolved = false;
  let resolveStop!: (reason: StopReason) => void;
  const listeners = new Map<NodeJS.Signals, () => void>();
  const promise = new Promise<StopReason>((resolve) => {
    resolveStop = resolve;
  });

  const dispose = () => {
    for (const [signal, listener] of listeners) {
      process.off(signal, listener);
    }
    listeners.clear();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = () => {
      if (resolved) return;
      resolved = true;
      resolveStop({ type: 'signal', signal });
    };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }

  return { promise, dispose };
}
