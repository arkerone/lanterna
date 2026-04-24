import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { connectCdp } from '../../inspector/client.js';
import { attachControlChannel } from '../../runtime-signals/control-channel.js';
import { createCaptureIntegrity, mergeCaptureIntegrityCounters } from '../core/session.js';
import type {
  ConnectedSource,
  EventLoopSample,
  LiveSourceSignals,
  PreloadContribution,
  ProfileSource,
  RawGcEvent,
  SpawnStartOptions,
} from '../core/types.js';
import { waitForInspectorUrl } from './inspector-url.js';
import { terminateSpawnedChild } from './terminate.js';

export class SpawnSource implements ProfileSource<SpawnStartOptions> {
  async connect(
    options: SpawnStartOptions,
    preload: PreloadContribution,
  ): Promise<ConnectedSource> {
    const [command, ...rawArgs] = options.command;
    if (!command) throw new Error('command is empty');
    const args =
      options.deep && isNodeExecutable(command) ? ['--trace-deopt', ...rawArgs] : rawArgs;

    options.onProgress?.({
      stage: 'spawn-target',
      message: `Starting ${[command, ...args].join(' ')} under Lanterna...`,
    });

    const preloadPath = join(
      tmpdir(),
      `lanterna-preload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`,
    );
    await writeFile(preloadPath, preload.preloadScript, { encoding: 'utf8' });

    const nodeOptions = ['--inspect-brk=0', `--require=${preloadPath}`];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, ...nodeOptions].filter(Boolean).join(' '),
      LANTERNA_ACTIVE: '1',
      LANTERNA_CONTROL_FD: String(preload.controlFd),
    };

    const child = spawn(command, args, {
      env,
      stdio: ['inherit', options.deep ? 'pipe' : 'inherit', 'pipe', 'pipe'],
    });

    if (options.deep && child.stdout) {
      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        options.onStdoutChunk?.(text);
        writeTargetStderr(text);
      });
    }

    const stderrBuffer: string[] = [];
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderrBuffer.push(text);
        options.onStderrChunk?.(text);
        writeTargetStderr(text);
      });
    }

    const captureIntegrity = createCaptureIntegrity({ controlChannelExpected: true });
    const gcEventsAbs: RawGcEvent[] = [];
    const eventLoopSamplesAbs: EventLoopSample[] = [];
    let eventLoopAvailable = false;
    let eventLoopResolutionMs: number | undefined;
    let appCompleted = false;
    let resolveAppCompletion = () => {};
    const appCompletionPromise = new Promise<void>((resolve) => {
      resolveAppCompletion = resolve;
    });

    const controlStream = (child.stdio[3] as NodeJS.ReadableStream | null | undefined) ?? undefined;
    if (controlStream) {
      attachControlChannel(controlStream, {
        onEvent(event) {
          captureIntegrity.controlChannel = true;
          if (event.type === 'hook-ready') {
            eventLoopAvailable = Boolean(event.capabilities?.eventLoop);
            eventLoopResolutionMs = event.eventLoopResolutionMs;
            captureIntegrity.gcObserverAvailable = Boolean(event.capabilities?.gc);
            mergeCaptureIntegrityCounters(captureIntegrity, event.integrity);
            return;
          }
          if (event.type === 'capture-start') {
            eventLoopResolutionMs = event.resolutionMs ?? eventLoopResolutionMs;
            return;
          }
          if (event.type === 'heartbeat') {
            eventLoopAvailable = true;
            captureIntegrity.eventLoopTimed = true;
            eventLoopSamplesAbs.push({ atMs: event.atMs, lagMs: event.lagMs });
            return;
          }
          if (event.type === 'gc') {
            captureIntegrity.gcTimed = true;
            gcEventsAbs.push({
              atMs: event.atMs,
              kind: event.kind ?? 'other',
              durationMs: event.durationMs,
            });
            return;
          }
          if (event.type === 'app-complete') {
            mergeCaptureIntegrityCounters(captureIntegrity, event.integrity);
            appCompleted = true;
            resolveAppCompletion();
          }
        },
      });
    }

    child.once('exit', () => resolveAppCompletion());

    try {
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

      let exited = false;
      let resolveExit = () => {};
      const exitPromise = new Promise<void>((resolve) => {
        resolveExit = resolve;
        child.once('exit', () => {
          exited = true;
          resolve();
        });
      });

      const waitForExit = async (): Promise<void> => {
        await Promise.race([appCompletionPromise, exitPromise]);
      };

      const drainLiveSignals = (): LiveSourceSignals => ({
        gcEventsAbs: [...gcEventsAbs],
        eventLoopSamplesAbs: [...eventLoopSamplesAbs],
        eventLoopAvailable,
        eventLoopResolutionMs,
        integrityCounters: {
          controlChannelWriteErrors: captureIntegrity.controlChannelWriteErrors,
          gcObserverSetupFailed: captureIntegrity.gcObserverSetupFailed,
          heartbeatDropped: captureIntegrity.heartbeatDropped,
        },
        appCompleted,
      });

      const finalize = async (args: { appCompleted: boolean }): Promise<void> => {
        try {
          await terminateSpawnedChild(child, args.appCompleted, exited, exitPromise);
          resolveExit();
        } finally {
          await rm(preloadPath, { force: true }).catch(() => {});
        }
      };

      // Release the inspector breakpoint so the target begins running.
      await cdp.send('Runtime.runIfWaitingForDebugger');

      return {
        cdp,
        target: {
          pid: child.pid ?? -1,
          nodeVersion: '',
          v8Version: '',
          platform: process.platform,
          arch: process.arch,
          cwd: process.cwd(),
        },
        startedAtEpoch: Date.now(),
        initialIntegrity: captureIntegrity,
        waitForExit,
        drainLiveSignals,
        finalize,
      };
    } catch (error) {
      await rm(preloadPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

export async function createSpawnSource(): Promise<SpawnSource> {
  return new SpawnSource();
}

function writeTargetStderr(chunk: string): void {
  try {
    writeSync(2, chunk);
  } catch {
    // Preserve profiling if the parent stderr pipe closes early.
  }
}

function isNodeExecutable(command: string): boolean {
  const executable = basename(command).toLowerCase();
  return executable === 'node' || executable === 'node.exe';
}
