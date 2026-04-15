import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { connectCdp, type CdpClient } from './cdp-client.js';
import {
  type ProfileSource,
  type SourceHandle,
  type StartOptions,
  type TargetInfo,
  type RawCapture,
  type RawGcEvent,
  type EventLoopSample,
  type EventLoopHistogram,
  type RawDeopt,
  type CaptureIntegrity,
} from './source.js';
import { startCpuMeasure, stopCpuMeasure } from './measures/cpu.js';
import { readEventLoopSamples } from './measures/event-loop.js';
import { parseDeoptsFromStderr } from './measures/deopts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class SpawnSource implements ProfileSource {
  async start(options: StartOptions): Promise<SourceHandle> {
    const [cmd, ...args] = options.command;
    if (!cmd) throw new Error('command is empty');

    const nodeOptions: string[] = ['--inspect-brk=0'];
    if (options.deep) {
      nodeOptions.push('--trace-deopt');
    }
    // Preload hook to expose event loop delay via a known global
    const hookPath = resolve(__dirname, 'measures', 'event-loop-hook.cjs');
    nodeOptions.push(`--require=${hookPath}`);

    const env = {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, ...nodeOptions].filter(Boolean).join(' '),
      LANTERNA_ACTIVE: '1',
      LANTERNA_CONTROL_FD: '3',
    };

    const child = spawn(cmd, args, {
      env,
      stdio: ['inherit', 'inherit', 'pipe', 'pipe'],
    });

    const control = child.stdio[3];
    const gcEventsAbs: RawGcEvent[] = [];
    const eventLoopSamplesAbs: EventLoopSample[] = [];
    const captureIntegrity: CaptureIntegrity = {
      controlChannel: false,
      eventLoopTimed: false,
      gcTimed: false,
      cpuSamplesTimed: false,
    };
    let appCompleted = false;
    let appCompletedAtMs: number | undefined;
    let eventLoopAvailable = false;
    let eventLoopResolutionMs: number | undefined;
    let eventLoopHistogram: EventLoopHistogram | undefined;
    let runtimeCompletionArmed = false;
    let resolveAppCompletionExternal = () => {};
    const appCompletionPromise = new Promise<void>((resolveDone) => {
      let settled = false;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolveDone();
      };
      resolveAppCompletionExternal = resolveOnce;

      if (control && 'on' in control) {
        attachControlChannel(control as NodeJS.ReadableStream, {
          onEvent(event) {
            captureIntegrity.controlChannel = true;
            if (event.type === 'hook-ready') {
              eventLoopAvailable = Boolean(event.capabilities?.eventLoop);
              eventLoopResolutionMs = event.eventLoopResolutionMs;
              return;
            }
            if (event.type === 'capture-start') {
              eventLoopResolutionMs = event.resolutionMs ?? eventLoopResolutionMs;
              return;
            }
            if (event.type === 'heartbeat') {
              eventLoopAvailable = true;
              captureIntegrity.eventLoopTimed = true;
              if (typeof event.atMs === 'number' && typeof event.lagMs === 'number') {
                eventLoopSamplesAbs.push({ atMs: event.atMs, lagMs: event.lagMs });
              }
              return;
            }
            if (event.type === 'gc') {
              captureIntegrity.gcTimed = true;
              if (typeof event.atMs === 'number' && typeof event.durationMs === 'number') {
                gcEventsAbs.push({
                  atMs: event.atMs,
                  kind: event.kind ?? 'other',
                  durationMs: event.durationMs,
                });
              }
              return;
            }
            if (event.type === 'app-complete') {
              appCompleted = true;
              if (typeof event.atMs === 'number') appCompletedAtMs = event.atMs;
              resolveOnce();
            }
          },
        });
      }

      child.once('exit', () => resolveOnce());
    });

    const stderrBuffer: string[] = [];
    const wsUrl = await waitForInspectorUrl(child, stderrBuffer);

    const cdp = await connectCdp(wsUrl);

    const target = await fetchTargetInfo(cdp, child.pid ?? -1);

    const markRuntimeComplete = () => {
      if (!runtimeCompletionArmed || appCompleted) return;
      appCompleted = true;
      resolveAppCompletionExternal();
    };
    cdp.on('Runtime.executionContextDestroyed', markRuntimeComplete);
    cdp.on('Runtime.executionContextsCleared', markRuntimeComplete);

    const startedAtEpoch = Date.now();
    const startedAtHr = performance.now();

    await markCaptureStart(cdp);
    const childCaptureStartMs = await readChildClockNow(cdp);
    await startCpuMeasure(cdp, options.sampleIntervalMicros);
    await cdp.send('Runtime.runIfWaitingForDebugger');
    runtimeCompletionArmed = true;

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
      const endedHr = performance.now();
      const durationMs = endedHr - startedAtHr;
      const eventLoopRead = await readEventLoopSamples(cdp);
      const mergedEventLoopAbs = mergeTimedSamples(
        eventLoopSamplesAbs,
        eventLoopRead.samples,
      );
      if (!captureIntegrity.eventLoopTimed && mergedEventLoopAbs.length > 0) {
        captureIntegrity.eventLoopTimed = true;
      }
      if (eventLoopRead.available) {
        eventLoopAvailable = true;
      }
      eventLoopResolutionMs = eventLoopRead.resolutionMs ?? eventLoopResolutionMs;
      const gcEvents = normalizeTimedEvents(gcEventsAbs, childCaptureStartMs, durationMs);
      const eventLoopSamples = normalizeTimedEvents(mergedEventLoopAbs, childCaptureStartMs, durationMs);

      let cpuProfile;

      try {
        cpuProfile = await stopCpuMeasure(cdp);
      } catch (err) {
        throw new Error(`failed to stop CPU profile: ${(err as Error).message}`);
      }

      captureIntegrity.cpuSamplesTimed = Boolean(
        cpuProfile.samples?.length
        && cpuProfile.timeDeltas?.length
        && cpuProfile.samples.length === cpuProfile.timeDeltas.length,
      );

      eventLoopHistogram = isUsableEventLoopSummary(
        eventLoopRead.summary,
        eventLoopRead.resolutionMs ?? eventLoopResolutionMs ?? 20,
      )
        ? eventLoopRead.summary
        : summarizeEventLoop(eventLoopSamples);

      await cdp.close().catch(() => {});

      if (!exited) {
        await Promise.race([exitPromise, new Promise<void>((r) => setTimeout(r, 500))]);
      }

      if (!exited && !appCompleted) {
        child.kill('SIGTERM');
        await Promise.race([exitPromise, new Promise<void>((r) => setTimeout(r, 2000))]);
        if (!exited) child.kill('SIGKILL');
      }

      const deopts: RawDeopt[] = options.deep
        ? parseDeoptsFromStderr(stderrBuffer.join(''))
        : [];

      return {
        target,
        startedAtEpoch,
        durationMs,
        cpuProfile,
        gcEvents,
        eventLoopSamples,
        eventLoopHistogram,
        eventLoopResolutionMs,
        eventLoopAvailable,
        captureIntegrity,
        deopts,
      };
    };

    const ensureStop = (): Promise<RawCapture> => {
      stopPromise ??= stopInternal();
      return stopPromise;
    };

    appCompletionPromise.then(() => {
      if (appCompleted && !stopped) {
        stopPromise ??= stopInternal();
      }
    }).catch(() => {});

    return {
      target,
      startedAt: startedAtEpoch,
      async waitForExit(): Promise<void> {
        await appCompletionPromise;
      },
      async stop(): Promise<RawCapture> {
        return ensureStop();
      },
    };
  }
}

interface ControlEvent {
  type: string;
  atMs?: number;
  lagMs?: number;
  kind?: string;
  durationMs?: number;
  resolutionMs?: number;
  eventLoopResolutionMs?: number;
  capabilities?: { eventLoop?: boolean };
}

function attachControlChannel(
  stream: NodeJS.ReadableStream,
  handlers: { onEvent: (event: ControlEvent) => void },
): void {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    while (true) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) break;
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        handlers.onEvent(JSON.parse(line) as ControlEvent);
      } catch {
        // Ignore malformed control events; the report carries integrity metadata.
      }
    }
  });
}

async function markCaptureStart(cdp: CdpClient): Promise<void> {
  await cdp.send('Runtime.evaluate', {
    expression: `globalThis.__LANTERNA_EVENT_LOOP__?.markCaptureStart?.()`,
    returnByValue: true,
  });
}

async function readChildClockNow(cdp: CdpClient): Promise<number> {
  const res = await cdp.send<{ result: { value?: number } }>('Runtime.evaluate', {
    expression: 'performance.now()',
    returnByValue: true,
  });
  return res.result?.value ?? 0;
}

function summarizeEventLoop(samples: EventLoopSample[]): EventLoopHistogram | undefined {
  if (samples.length === 0) return undefined;
  const values = samples.map((s) => s.lagMs).sort((a, b) => a - b);
  const maxMs = values[values.length - 1] ?? 0;
  const meanMs = values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    maxMs,
    meanMs,
    p50Ms: percentile(values, 0.5),
    p99Ms: percentile(values, 0.99),
  };
}

function mergeTimedSamples(
  controlSamples: EventLoopSample[],
  runtimeSamples: EventLoopSample[],
): EventLoopSample[] {
  const merged = new Map<string, EventLoopSample>();
  for (const sample of [...controlSamples, ...runtimeSamples]) {
    const key = `${sample.atMs.toFixed(3)}:${sample.lagMs.toFixed(3)}`;
    merged.set(key, sample);
  }
  return Array.from(merged.values());
}

function isUsableEventLoopSummary(
  summary: Awaited<ReturnType<typeof readEventLoopSamples>>['summary'],
  resolutionMs: number,
): summary is NonNullable<Awaited<ReturnType<typeof readEventLoopSamples>>['summary']> {
  if (!summary || summary.count <= 0) return false;
  if (!Number.isFinite(summary.maxMs)
    || !Number.isFinite(summary.meanMs)
    || !Number.isFinite(summary.p50Ms)
    || !Number.isFinite(summary.p99Ms)) {
    return false;
  }
  const minimumExpectedLagMs = Math.max(1, resolutionMs / 10);
  return summary.maxMs >= minimumExpectedLagMs
    || summary.p99Ms >= minimumExpectedLagMs
    || summary.p50Ms >= minimumExpectedLagMs;
}

function percentile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * q) - 1));
  return sortedValues[idx] ?? 0;
}

function normalizeTimedEvents<T extends { atMs: number }>(
  events: T[],
  startMs: number,
  durationMs: number,
): T[] {
  return events
    .map((event) => ({ ...event, atMs: Math.max(0, event.atMs - startMs) }))
    .filter((event) => event.atMs <= durationMs + 1000)
    .sort((a, b) => a.atMs - b.atMs);
}

function waitForInspectorUrl(child: ChildProcess, buffer: string[]): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const stderr = child.stderr;
    if (!stderr) {
      reject(new Error('child has no stderr'));
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      rejectOnce(buildInspectorStartupError(
        buffer,
        'timed out waiting for inspector URL (5s). Is the target a node process?',
      ));
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };

    const rejectOnce = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      terminateChild(child);
      reject(err);
    };

    const resolveOnce = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveUrl(url);
    };

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      buffer.push(s);
      process.stderr.write(s);
      if (settled) return;

      const startupFailure = getInspectorStartupFailure(buffer);
      if (startupFailure) {
        rejectOnce(new Error(
          `unable to start Node inspector for target process: ${startupFailure}. `
          + 'Lanterna requires Node inspector support in the current environment.',
        ));
        return;
      }

      const m = /Debugger listening on (ws:\/\/[^\s]+)/.exec(s);
      if (m) {
        resolveOnce(m[1]!);
      }
    };

    const onError = (err: Error) => {
      rejectOnce(err);
    };

    const onExit = (code: number | null) => {
      rejectOnce(buildInspectorStartupError(
        buffer,
        `child exited before inspector was ready (code=${code})`,
      ));
    };

    stderr.on('data', onData);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

function buildInspectorStartupError(buffer: string[], fallbackMessage: string): Error {
  const startupFailure = getInspectorStartupFailure(buffer);
  if (startupFailure) {
    return new Error(
      `unable to start Node inspector for target process: ${startupFailure}. `
      + 'Lanterna requires Node inspector support in the current environment.',
    );
  }

  const lastStderrLine = getLastNonEmptyLine(buffer.join(''));
  if (lastStderrLine) {
    return new Error(`${fallbackMessage}. Last stderr line: ${lastStderrLine}`);
  }
  return new Error(fallbackMessage);
}

function getInspectorStartupFailure(buffer: string[]): string | undefined {
  const joined = buffer.join('');
  const match = joined.match(/Starting inspector on [^\n]+ failed: ([^\n]+)/);
  return match?.[1]?.trim();
}

function getLastNonEmptyLine(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1];
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  }, 250).unref();
}

async function fetchTargetInfo(cdp: CdpClient, pid: number): Promise<TargetInfo> {
  await cdp.send('Runtime.enable');
  const exprs = `JSON.stringify({
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd()
  })`;
  const res = await cdp.send<{ result: { value?: string } }>('Runtime.evaluate', {
    expression: exprs,
    returnByValue: true,
  });
  const value = res.result?.value ?? '{}';
  const parsed = JSON.parse(value) as Omit<TargetInfo, 'pid'>;
  return { pid, ...parsed };
}
