import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectCdp } from '../../inspector/client.js';
import { readEventLoopSamples } from '../../runtime-signals/readers/event-loop.js';
import { readRuntimeIntegrity } from '../../runtime-signals/readers/integrity.js';
import { parseDeoptsFromStderr } from '../core/deopts.js';
import {
  createCaptureIntegrity,
  finishCaptureSession,
  mergeCaptureIntegrityCounters,
  startCaptureSession,
} from '../core/session.js';
import type { ProfileSource, RawCapture, SourceHandle, SpawnStartOptions } from '../core/types.js';
import { createSpawnLifecycle } from './child-lifecycle.js';
import { waitForInspectorUrl } from './inspector-url.js';
import { terminateSpawnedChild } from './terminate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class SpawnSource implements ProfileSource<SpawnStartOptions> {
  async start(options: SpawnStartOptions): Promise<SourceHandle> {
    const [command, ...args] = options.command;
    if (!command) throw new Error('command is empty');

    options.onProgress?.({
      stage: 'spawn-target',
      message: `Starting ${[command, ...args].join(' ')} under Lanterna...`,
    });
    const child = spawn(command, args, {
      env: buildSpawnEnvironment(options.deep),
      stdio: ['inherit', 'inherit', 'pipe', 'pipe'],
    });

    const stderrBuffer: string[] = [];
    const captureIntegrity = createCaptureIntegrity({ controlChannelExpected: true });
    const lifecycle = createSpawnLifecycle(
      child,
      child.stdio[3] as NodeJS.ReadableStream | null | undefined,
      captureIntegrity,
    );

    options.onProgress?.({
      stage: 'wait-inspector',
      message: 'Waiting for the child process to expose its inspector endpoint...',
    });
    const webSocketDebuggerUrl = await waitForInspectorUrl(child, stderrBuffer);
    options.onProgress?.({
      stage: 'connect-cdp',
      message: 'Connecting to the child process over CDP...',
    });
    const cdp = await connectCdp(webSocketDebuggerUrl);
    options.onProgress?.({
      stage: 'prepare-runtime',
      message: options.deep
        ? 'Preparing runtime hooks and deopt tracing...'
        : 'Preparing runtime hooks and control signals...',
    });
    const session = await startCaptureSession(cdp, options.sampleIntervalMicros, {
      pid: child.pid ?? undefined,
    });

    const markRuntimeComplete = () => {
      lifecycle.markRuntimeComplete();
    };
    const detachRuntimeDestroyed = cdp.on('Runtime.executionContextDestroyed', markRuntimeComplete);
    const detachRuntimeCleared = cdp.on('Runtime.executionContextsCleared', markRuntimeComplete);
    const detachClose = cdp.onClose(markRuntimeComplete);

    options.onProgress?.({
      stage: 'start-capture',
      message: 'Starting CPU capture and releasing the child process...',
    });
    await cdp.send('Runtime.runIfWaitingForDebugger');
    lifecycle.armRuntimeCompletion();

    let stopped = false;
    let exited = false;
    let stopPromise: Promise<RawCapture> | null = null;
    const exitPromise = new Promise<void>((resolveExit) => {
      child.once('exit', () => {
        exited = true;
        resolveExit();
      });
    });

    const stopInternal = async (): Promise<RawCapture> => {
      if (stopped) {
        if (!stopPromise) throw new Error('stop() called twice');
        return stopPromise;
      }
      stopped = true;
      detachRuntimeDestroyed();
      detachRuntimeCleared();
      detachClose();

      const eventLoopRead = await readEventLoopSamples(session.cdp);
      if (eventLoopRead.available) {
        lifecycle.state.eventLoopAvailable = true;
      }
      lifecycle.state.eventLoopResolutionMs =
        eventLoopRead.resolutionMs ?? lifecycle.state.eventLoopResolutionMs;
      mergeCaptureIntegrityCounters(
        lifecycle.state.captureIntegrity,
        await readRuntimeIntegrity(session.cdp),
      );

      const rawCapture = await finishCaptureSession({
        session,
        captureIntegrity: lifecycle.state.captureIntegrity,
        gcEventsAbs: lifecycle.state.gcEventsAbs,
        eventLoopSamplesAbs: lifecycle.state.eventLoopSamplesAbs,
        eventLoopRead,
        eventLoopAvailable: lifecycle.state.eventLoopAvailable,
        eventLoopResolutionMs: lifecycle.state.eventLoopResolutionMs,
        deopts: options.deep ? parseDeoptsFromStderr(stderrBuffer.join('')) : [],
      });

      await terminateSpawnedChild(child, lifecycle.state.appCompleted, exited, exitPromise);
      return rawCapture;
    };

    const ensureStop = (): Promise<RawCapture> => {
      stopPromise ??= stopInternal();
      return stopPromise;
    };

    lifecycle
      .waitForAppCompletion()
      .then(() => {
        if (lifecycle.state.appCompleted && !stopped) {
          stopPromise ??= stopInternal();
        }
      })
      .catch(() => {});

    return {
      target: session.target,
      startedAt: session.startedAtEpoch,
      async waitForExit(): Promise<void> {
        await lifecycle.waitForAppCompletion();
      },
      async stop(): Promise<RawCapture> {
        return ensureStop();
      },
    };
  }
}

function buildSpawnEnvironment(deep: boolean): NodeJS.ProcessEnv {
  const nodeOptions = ['--inspect-brk=0'];
  if (deep) {
    nodeOptions.push('--trace-deopt');
  }

  const hookPath = resolve(
    __dirname,
    '..',
    '..',
    'runtime-signals',
    'hooks',
    'event-loop-hook.cjs',
  );
  nodeOptions.push(`--require=${hookPath}`);

  return {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, ...nodeOptions].filter(Boolean).join(' '),
    LANTERNA_ACTIVE: '1',
    LANTERNA_CONTROL_FD: '3',
  };
}
