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

interface InstallAttachRuntimeResult {
  installed?: boolean;
  reason?: string;
}

export class AttachSource implements ProfileSource<AttachStartOptions> {
  async start(options: AttachStartOptions): Promise<CaptureHandle> {
    const webSocketDebuggerUrl = options.inspectUrl
      ?? await openInspectorForPid(options.pid ?? -1);
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
      await installAttachRuntimeHook(cdp);
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
        const gcEventsAbs = cdp.closed ? [] : await readGcEvents(cdp);
        const eventLoopRead = cdp.closed
          ? { samples: [], available: false, resolutionMs: undefined, summary: undefined }
          : await readEventLoopSamples(cdp);

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
  const value = await cdp.evaluate(ATTACH_RUNTIME_HOOK_SOURCE, { awaitPromise: true });
  const result = (value ?? {}) as InstallAttachRuntimeResult;
  if (result.installed) return;
  throw new Error(
    result.reason
      ? `failed to install attach runtime hook: ${result.reason}`
      : 'failed to install attach runtime hook',
  );
}
