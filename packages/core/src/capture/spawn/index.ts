import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { connectCdp } from '../../inspector/client.js';
import type { MemoryUsageSample } from '../../report/types.js';
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
  TargetCrashInfo,
  TargetExitInfo,
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
      options.traceDeopt && isNodeExecutable(command) ? ['--trace-deopt', ...rawArgs] : rawArgs;

    options.onProgress?.({
      stage: 'spawn-target',
      message: `Starting ${[command, ...args].join(' ')} under Lanterna...`,
    });

    const preloadPath = join(
      tmpdir(),
      `lanterna-preload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`,
    );
    await writeFile(preloadPath, preload.preloadScript, { encoding: 'utf8' });

    // The preload path is double-quoted: NODE_OPTIONS parses quoted arguments,
    // and temp paths can contain spaces (e.g. Windows user profiles).
    const nodeOptions = ['--inspect-brk=0', `--require "${preloadPath}"`, ...preload.nodeOptions];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, ...nodeOptions].filter(Boolean).join(' '),
      // The preload restores NODE_OPTIONS to the parent value once it has
      // loaded, so descendant Node processes don't inherit the inspector flags
      // and preload (see composePreloadScript).
      ...(process.env.NODE_OPTIONS !== undefined
        ? { LANTERNA_PARENT_NODE_OPTIONS: process.env.NODE_OPTIONS }
        : {}),
      LANTERNA_ACTIVE: '1',
      LANTERNA_CONTROL_FD: String(preload.controlFd),
    };

    const child = spawn(command, args, {
      env,
      stdio: ['inherit', options.traceDeopt ? 'pipe' : 'inherit', 'pipe', 'pipe'],
    });

    if (options.traceDeopt && child.stdout) {
      const routeTraceDeoptStdout = createTraceDeoptStdoutRouter({
        onDiagnosticChunk: options.onStdoutChunk,
        onTargetStdoutChunk: writeTargetStdout,
      });
      child.stdout.on('data', (chunk: Buffer | string) => {
        routeTraceDeoptStdout(chunk.toString());
      });
      child.stdout.on('end', () => {
        routeTraceDeoptStdout('', true);
      });
    }

    // Only collected to build a useful error message if the inspector never
    // comes up (buildInspectorStartupError in inspector-url.ts). Bounded so a
    // chatty target can't grow this profiler-side buffer unboundedly, and
    // collection stops once the inspector URL resolves — nothing reads it
    // after that point.
    const STDERR_COLLECTION_CAP_BYTES = 512 * 1024;
    const stderrBuffer: string[] = [];
    let stderrBufferBytes = 0;
    let collectingStderr = true;
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        if (collectingStderr && stderrBufferBytes < STDERR_COLLECTION_CAP_BYTES) {
          stderrBuffer.push(text);
          stderrBufferBytes += Buffer.byteLength(text, 'utf8');
        }
        options.onStderrChunk?.(text);
        writeTargetStderr(text);
      });
    }

    const captureIntegrity = createCaptureIntegrity({ controlChannelExpected: true });
    const gcEventsAbs: RawGcEvent[] = [];
    const eventLoopSamplesAbs: EventLoopSample[] = [];
    const memoryUsageSamples: MemoryUsageSample[] = [];
    let eventLoopAvailable = false;
    let eventLoopResolutionMs: number | undefined;
    let memoryUsageSampleIntervalMs: number | undefined;
    let appCompleted = false;
    let targetExit: TargetExitInfo | undefined;
    let targetCrash: TargetCrashInfo | undefined;
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
          if (event.type === 'memory-usage') {
            if (!event.captureStarted) return;
            memoryUsageSampleIntervalMs = event.sampleIntervalMs;
            memoryUsageSamples.push({
              atMs: event.atMs,
              rss: event.rss,
              heapTotal: event.heapTotal,
              heapUsed: event.heapUsed,
              external: event.external,
              arrayBuffers: event.arrayBuffers,
            });
            return;
          }
          if (event.type === 'app-complete') {
            mergeCaptureIntegrityCounters(captureIntegrity, event.integrity);
            appCompleted = true;
            resolveAppCompletion();
            return;
          }
          if (event.type === 'crash') {
            targetCrash = { kind: event.kind, message: event.message };
          }
        },
      });
    }

    child.once('exit', (code, signal) => {
      targetExit = { code, signal };
      resolveAppCompletion();
    });

    try {
      options.onProgress?.({
        stage: 'wait-inspector',
        message: 'Waiting for the child process to expose its inspector endpoint...',
      });
      const webSocketDebuggerUrl = await waitForInspectorUrl(child, stderrBuffer);
      collectingStderr = false;
      stderrBuffer.length = 0;
      options.onProgress?.({
        stage: 'connect-cdp',
        message: 'Connecting to the child process over CDP...',
      });
      const cdp = await connectCdp(webSocketDebuggerUrl);

      options.onProgress?.({
        stage: 'prepare-runtime',
        message: options.traceDeopt
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
        memoryUsageSamples: [...memoryUsageSamples],
        memoryUsageSampleIntervalMs,
        integrityCounters: {
          controlChannelWriteErrors: captureIntegrity.controlChannelWriteErrors,
          gcObserverSetupFailed: captureIntegrity.gcObserverSetupFailed,
          heartbeatDropped: captureIntegrity.heartbeatDropped,
          eventLoopSamplesDropped: captureIntegrity.eventLoopSamplesDropped,
          gcEventsDropped: captureIntegrity.gcEventsDropped,
          memoryUsageSamplesDropped: captureIntegrity.memoryUsageSamplesDropped,
        },
        appCompleted,
        ...(targetExit ? { targetExit } : {}),
        ...(targetCrash ? { targetCrash } : {}),
      });

      const finalize = async (args: { appCompleted: boolean }): Promise<void> => {
        try {
          await terminateSpawnedChild(child, args.appCompleted, exited, exitPromise);
          resolveExit();
        } finally {
          await rm(preloadPath, { force: true }).catch(() => {});
        }
      };

      return {
        cdp,
        mode: 'spawn',
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
        releaseRuntime: async () => {
          // Without an enabled Debugger domain, `--inspect-brk` releases on
          // `runIfWaitingForDebugger` alone — V8 has no agent to deliver the
          // start pause to. Waiting for `Debugger.paused` in that case used to
          // burn a fixed 500ms on every default (cpu-only) capture.
          if (!cdp.debuggerDomainEnabled) {
            await cdp.send('Runtime.runIfWaitingForDebugger');
            return;
          }
          let resolvePaused = () => {};
          const pausedPromise = new Promise<void>((resolve) => {
            resolvePaused = resolve;
          });
          const unsubscribePaused = cdp.on('Debugger.paused', resolvePaused);
          await cdp.send('Runtime.runIfWaitingForDebugger');
          try {
            await Promise.race([pausedPromise, new Promise((resolve) => setTimeout(resolve, 500))]);
            await cdp.send('Debugger.resume');
          } catch {
            // The target may already be running if the pause was already consumed.
          } finally {
            unsubscribePaused();
          }
        },
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

function writeTargetStdout(chunk: string): void {
  try {
    writeSync(1, chunk);
  } catch {
    // Preserve profiling if the parent stdout pipe closes early.
  }
}

function createTraceDeoptStdoutRouter(options: {
  onDiagnosticChunk?: (chunk: string) => void;
  onTargetStdoutChunk: (chunk: string) => void;
}): (chunk: string, flush?: boolean) => void {
  let pending = '';
  return (chunk, flush = false) => {
    const combined = pending + chunk;
    const lines = combined.split(/(?<=\n)/);
    pending = '';

    if (!flush && lines.length > 0 && !lines[lines.length - 1]?.endsWith('\n')) {
      pending = lines.pop() ?? '';
    }

    for (const line of lines) {
      if (line.length === 0) continue;
      if (isV8TraceDiagnostic(line)) {
        options.onDiagnosticChunk?.(line);
      } else {
        options.onTargetStdoutChunk(line);
      }
    }
  };
}

function isV8TraceDiagnostic(line: string): boolean {
  return /^\[(?:marking|bailout|deoptimiz)/i.test(line);
}

function isNodeExecutable(command: string): boolean {
  const executable = basename(command).toLowerCase();
  return executable === 'node' || executable === 'node.exe';
}
