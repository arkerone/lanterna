import { connectCdp, type CdpClient } from '../inspector/client.js';
import { openInspectorForPid } from '../inspector/discovery.js';
import {
  createCaptureIntegrity,
  finishCaptureSession,
  startCaptureSession,
} from './core/session.js';
import type {
  AttachStartOptions,
  CaptureHandle,
  ProfileSource,
  RawCapture,
} from './core/types.js';
import { readEventLoopSamples } from '../runtime-signals/readers/event-loop.js';
import { readGcEvents } from '../runtime-signals/readers/gc.js';
import { ATTACH_RUNTIME_HOOK_SOURCE } from '../runtime-signals/hooks/runtime-hook.js';
import { sleep } from '../shared/sleep.js';

const ATTACH_FINALIZE_READ_TIMEOUT_MS = 1_500;

interface InstallAttachRuntimeResult {
  installed?: boolean;
  reason?: string;
}

export class AttachSource implements ProfileSource<AttachStartOptions> {
  async start(options: AttachStartOptions): Promise<CaptureHandle> {
    options.onProgress?.({
      stage: 'resolve-target',
      message: options.inspectUrl
        ? 'Using the inspector endpoint provided via --inspect-url.'
        : `Resolving an attachable inspector endpoint for pid ${options.pid ?? 'unknown'}...`,
    });

    const webSocketDebuggerUrl = options.inspectUrl
      ?? await openInspectorForPid(options.pid ?? -1, (message) => {
        options.onProgress?.({
          stage: 'inspector-ready',
          message,
        });
      });

    options.onProgress?.({
      stage: 'connect-cdp',
      message: 'Connecting to the Chrome DevTools Protocol endpoint...',
    });
    const cdp = await connectCdp(webSocketDebuggerUrl);

    let stopPromise: Promise<RawCapture> | null = null;
    let stopped = false;
    let exitSignaled = false;
    let stopInternal: (() => Promise<RawCapture>) | undefined;
    let resolveExit = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    try {
      options.onProgress?.({
        stage: 'install-hooks',
        message: 'Installing Lanterna runtime hooks on the target process...',
      });
      await installAttachRuntimeHook(cdp);
      options.onProgress?.({
        stage: 'start-capture',
        message: 'Starting CPU capture and synchronizing runtime clocks...',
      });
      const session = await startCaptureSession(cdp, options.sampleIntervalMicros, {
        pid: options.pid,
      });
      if (options.pid !== undefined && session.target.pid !== options.pid) {
        throw new Error(`inspector target pid mismatch: expected ${options.pid}, got ${session.target.pid}`);
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

      stopInternal = async (): Promise<RawCapture> => {
        if (stopped) {
          if (!stopPromise) throw new Error('stop() called twice');
          return stopPromise;
        }
        stopped = true;
        detachRuntimeHandler();
        detachContextHandler();
        detachCloseHandler();

        const captureIntegrity = createCaptureIntegrity();
        const gcEventsAbs = cdp.closed ? [] : await withTimeout(
          readGcEvents(cdp),
          ATTACH_FINALIZE_READ_TIMEOUT_MS,
          [],
        );
        const eventLoopRead = cdp.closed
          ? { samples: [], available: false, resolutionMs: undefined, summary: undefined }
          : await withTimeout(
            readEventLoopSamples(cdp),
            ATTACH_FINALIZE_READ_TIMEOUT_MS,
            { samples: [], available: false, resolutionMs: undefined, summary: undefined },
          );

        captureIntegrity.eventLoopTimed = eventLoopRead.samples.length > 0;
        captureIntegrity.gcTimed = gcEventsAbs.length > 0;

        return finishCaptureSession({
          session,
          captureIntegrity,
          gcEventsAbs,
          eventLoopRead,
          eventLoopAvailable: eventLoopRead.available,
        });
      };

      return {
        target: session.target,
        startedAt: session.startedAtEpoch,
        async waitForExit(): Promise<void> {
          await exitPromise;
        },
        async stop(): Promise<RawCapture> {
          if (!stopInternal) throw new Error('attach capture failed to initialize');
          stopPromise ??= stopInternal();
          return stopPromise;
        },
      };
    } catch (error) {
      await cdp.close().catch(() => {});
      throw error;
    }
  }
}

export async function startAttachCapture(
  options: AttachStartOptions,
): Promise<CaptureHandle> {
  return new AttachSource().start(options);
}

async function installAttachRuntimeHook(cdp: CdpClient): Promise<void> {
  const value = await cdp.evaluate(ATTACH_RUNTIME_HOOK_SOURCE);
  const result = (value ?? {}) as InstallAttachRuntimeResult;
  if (result.installed) return;
  throw new Error(
    result.reason
      ? `failed to install attach runtime hook: ${result.reason}`
      : 'failed to install attach runtime hook',
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return await Promise.race([
    promise.catch(() => fallback),
    sleep(timeoutMs).then(() => fallback),
  ]);
}
