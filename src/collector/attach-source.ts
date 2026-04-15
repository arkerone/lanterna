import { connectCdp, type CdpClient } from './cdp-client.js';
import type {
  AttachStartOptions,
  CaptureIntegrity,
  ProfileSource,
  RawCapture,
  RawDeopt,
  SourceHandle,
} from './source.js';
import { startCpuMeasure, stopCpuMeasure } from './measures/cpu.js';
import { readEventLoopSamples } from './measures/event-loop.js';
import { readGcEvents } from './measures/gc.js';
import {
  fetchTargetInfo,
  hasTimedCpuSamples,
  isUsableEventLoopSummary,
  markCaptureStart,
  normalizeTimedEvents,
  readRuntimeClockNow,
  summarizeEventLoop,
} from './capture-utils.js';
import { ATTACH_RUNTIME_HOOK_SOURCE } from './runtime-hook.js';

const INSPECTOR_DISCOVERY_TIMEOUT_MS = 5_000;
const INSPECTOR_DISCOVERY_INTERVAL_MS = 100;
const DEFAULT_INSPECTOR_DISCOVERY_URL = 'http://127.0.0.1:9229/json/list';

interface InspectorTargetDescriptor {
  webSocketDebuggerUrl?: string;
}

export class AttachSource implements ProfileSource<AttachStartOptions> {
  async start(options: AttachStartOptions): Promise<SourceHandle> {
    const wsUrl = options.inspectUrl
      ?? await openInspectorForPid(options.pid ?? -1);
    const cdp = await connectCdp(wsUrl);

    let stopPromise: Promise<RawCapture> | null = null;
    let stopped = false;
    let exitSignaled = false;
    let stopInternal: (() => Promise<RawCapture>) | undefined;
    let resolveExit = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    try {
      await installAttachRuntimeHook(cdp);
      const target = await fetchTargetInfo(cdp);
      if (options.pid !== undefined && target.pid !== options.pid) {
        throw new Error(`inspector target pid mismatch: expected ${options.pid}, got ${target.pid}`);
      }

      const signalExit = () => {
        if (exitSignaled) return;
        exitSignaled = true;
        resolveExit();
        if (!stopped && stopInternal) {
          stopPromise ??= stopInternal();
        }
      };

      const detachRuntimeHandler = cdp.on('Runtime.executionContextsCleared', signalExit);
      const detachContextHandler = cdp.on('Runtime.executionContextDestroyed', signalExit);
      const detachCloseHandler = cdp.onClose(signalExit);

      const startedAtEpoch = Date.now();
      const startedAtHr = performance.now();

      await markCaptureStart(cdp);
      const runtimeCaptureStartMs = await readRuntimeClockNow(cdp);
      await startCpuMeasure(cdp, options.sampleIntervalMicros);

      stopInternal = async (): Promise<RawCapture> => {
        if (stopped) {
          if (!stopPromise) throw new Error('stop() called twice');
          return stopPromise;
        }
        stopped = true;
        detachRuntimeHandler();
        detachContextHandler();
        detachCloseHandler();

        const durationMs = performance.now() - startedAtHr;
        const captureIntegrity: CaptureIntegrity = {
          controlChannel: false,
          eventLoopTimed: false,
          gcTimed: false,
          cpuSamplesTimed: false,
        };

        const gcEventsAbs = cdp.closed ? [] : await readGcEvents(cdp);
        const eventLoopRead = cdp.closed
          ? { samples: [], available: false, resolutionMs: undefined, summary: undefined }
          : await readEventLoopSamples(cdp);
        const eventLoopSamples = normalizeTimedEvents(
          eventLoopRead.samples,
          runtimeCaptureStartMs,
          durationMs,
        );
        const gcEvents = normalizeTimedEvents(gcEventsAbs, runtimeCaptureStartMs, durationMs);

        captureIntegrity.eventLoopTimed = eventLoopSamples.length > 0;
        captureIntegrity.gcTimed = gcEvents.length > 0;

        let cpuProfile;
        try {
          cpuProfile = await stopCpuMeasure(cdp);
        } catch (err) {
          throw new Error(`failed to stop CPU profile: ${(err as Error).message}`);
        }

        captureIntegrity.cpuSamplesTimed = hasTimedCpuSamples(cpuProfile);

        const eventLoopHistogram = isUsableEventLoopSummary(
          eventLoopRead.summary,
          eventLoopRead.resolutionMs ?? 20,
        )
          ? eventLoopRead.summary
          : summarizeEventLoop(eventLoopSamples);

        await cdp.close().catch(() => {});

        const deopts: RawDeopt[] = [];
        return {
          target,
          startedAtEpoch,
          durationMs,
          cpuProfile,
          gcEvents,
          eventLoopSamples,
          eventLoopHistogram,
          eventLoopResolutionMs: eventLoopRead.resolutionMs,
          eventLoopAvailable: eventLoopRead.available || eventLoopSamples.length > 0,
          captureIntegrity,
          deopts,
        };
      };

      return {
        target,
        startedAt: startedAtEpoch,
        async waitForExit(): Promise<void> {
          await exitPromise;
        },
        async stop(): Promise<RawCapture> {
          if (!stopInternal) throw new Error('attach capture failed to initialize');
          stopPromise ??= stopInternal();
          return stopPromise;
        },
      };
    } catch (err) {
      await cdp.close().catch(() => {});
      throw err;
    }
  }
}

async function installAttachRuntimeHook(cdp: CdpClient): Promise<void> {
  const res = await cdp.send<{ result: { value?: { installed?: boolean; reason?: string } } }>('Runtime.evaluate', {
    expression: ATTACH_RUNTIME_HOOK_SOURCE,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = res.result?.value;
  if (value?.installed) return;
  throw new Error(
    value?.reason
      ? `failed to install attach runtime hook: ${value.reason}`
      : 'failed to install attach runtime hook',
  );
}

async function openInspectorForPid(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid --pid: ${pid}`);
  }
  if (process.platform === 'win32') {
    throw new Error('`lanterna attach --pid` is not supported on Windows; use --inspect-url instead');
  }

  const existingUrl = await readInspectorUrl();
  if (existingUrl && await inspectorUrlMatchesPid(existingUrl, pid)) {
    return existingUrl;
  }

  try {
    process.kill(pid, 'SIGUSR1');
  } catch (err) {
    throw new Error(`failed to signal pid ${pid} with SIGUSR1: ${(err as Error).message}`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < INSPECTOR_DISCOVERY_TIMEOUT_MS) {
    const wsUrl = await readInspectorUrl();
    if (wsUrl && wsUrl !== existingUrl && await inspectorUrlMatchesPid(wsUrl, pid)) {
      return wsUrl;
    }
    await sleep(INSPECTOR_DISCOVERY_INTERVAL_MS);
  }

  throw new Error(
    `timed out waiting for inspector on pid ${pid}. `
    + 'Ensure the process is Node.js and that port 9229 is available, or pass --inspect-url.',
  );
}

async function readInspectorUrl(): Promise<string | undefined> {
  try {
    const response = await fetch(DEFAULT_INSPECTOR_DISCOVERY_URL);
    if (!response.ok) return undefined;
    const targets = await response.json() as InspectorTargetDescriptor[];
    return targets.find((target) => typeof target.webSocketDebuggerUrl === 'string')?.webSocketDebuggerUrl;
  } catch {
    return undefined;
  }
}

async function inspectorUrlMatchesPid(wsUrl: string, pid: number): Promise<boolean> {
  let cdp: CdpClient | undefined;
  try {
    cdp = await connectCdp(wsUrl);
    const target = await fetchTargetInfo(cdp);
    return target.pid === pid;
  } catch {
    return false;
  } finally {
    await cdp?.close().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
