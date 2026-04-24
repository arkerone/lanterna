import { fetchTargetInfo, markCaptureStart, readRuntimeClockNow } from '../inspector/runtime.js';
import type { KindProbeOptions, ProfileKind } from '../kinds/core/types.js';
import { composeAttachScript, composePreloadScript } from '../runtime-signals/hooks/framework.js';
import { runtimeSignalsInstaller } from '../runtime-signals/hooks/installers/runtime-signals.js';
import {
  type EventLoopReadResult,
  readEventLoopSamples,
} from '../runtime-signals/readers/event-loop.js';
import { readGcEvents } from '../runtime-signals/readers/gc.js';
import { readRuntimeIntegrity } from '../runtime-signals/readers/integrity.js';
import { HEARTBEAT_RESOLUTION_MS } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { sleep } from '../shared/sleep.js';
import {
  captureDiagnosticMessage,
  mergeCaptureIntegrityCounters,
  recordCaptureDiagnostic,
} from './core/session.js';
import {
  isUsableEventLoopSummary,
  mergeTimedSamples,
  normalizeTimedEvents,
  summarizeEventLoop,
} from './core/timed-signals.js';
import type {
  CaptureBundle,
  CaptureIntegrity,
  ConnectedSource,
  EventLoopHistogram,
  EventLoopSample,
  LiveSourceSignals,
  PreloadContribution,
  ProfileSource,
  RawGcEvent,
  RuntimeSignalsData,
} from './core/types.js';

export interface RunCaptureOptions<TSourceOptions> {
  source: ProfileSource<TSourceOptions>;
  sourceOptions: TSourceOptions;
  kinds: ProfileKind[];
  probeOptions: KindProbeOptions;
  /** Duration of the capture (ms). Omit to run until exit / manual stop. */
  durationMs?: number;
  /** External stop signal. When it resolves, the coordinator stops. */
  stopSignal?: Promise<void>;
}

/**
 * Drives an end-to-end capture: composes the preload hook, asks the source
 * for a connected CDP endpoint, starts each kind's probe, waits for
 * duration / exit / stop, collects probe outputs + runtime signals, and
 * returns a {@link CaptureBundle}.
 */
export async function runCapture<TSourceOptions>(
  options: RunCaptureOptions<TSourceOptions>,
): Promise<CaptureBundle> {
  const installers = [runtimeSignalsInstaller];
  for (const kind of options.kinds) {
    if (kind.hookInstaller) installers.push(kind.hookInstaller);
  }

  const preload: PreloadContribution = {
    preloadScript: composePreloadScript(installers, {
      resolutionMs: HEARTBEAT_RESOLUTION_MS,
      emitLifecycle: true,
    }),
    attachScript: composeAttachScript(installers, {
      resolutionMs: HEARTBEAT_RESOLUTION_MS,
    }),
    controlFd: 3,
  };

  const connected = await options.source.connect(options.sourceOptions, preload);
  const session = new CaptureSession(connected);
  const cdp = connected.cdp;
  const captureIntegrity: CaptureIntegrity = connected.initialIntegrity;

  try {
    const target = await fetchTargetInfo(cdp, { pid: connected.target.pid });
    await markCaptureStart(cdp);
    const runtimeCaptureStartMs = await readRuntimeClockNow(cdp);
    const startedAtHr = performance.now();
    emitCaptureProgress(options.sourceOptions, {
      stage: 'start-capture',
      message: 'Runtime capture clock started. Starting profile probes...',
    });

    const probeInstances = [] as Array<{
      kind: ProfileKind;
      probe: ReturnType<ProfileKind['createProbe']>;
    }>;
    for (const kind of options.kinds) {
      const probe = kind.createProbe(options.probeOptions);
      try {
        await probe.install?.(cdp);
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind probe install failed');
        recordCaptureDiagnostic(captureIntegrity, {
          stage: 'probe-install',
          kindId: kind.id,
          message: captureDiagnosticMessage(error),
        });
        continue;
      }
      probeInstances.push({ kind, probe });
    }

    for (const { kind, probe } of probeInstances) {
      try {
        await probe.start(cdp);
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to start');
        recordCaptureDiagnostic(captureIntegrity, {
          stage: 'probe-start',
          kindId: kind.id,
          message: captureDiagnosticMessage(error),
        });
      }
    }

    emitCaptureProgress(options.sourceOptions, {
      stage: 'capture-running',
      message:
        options.durationMs === undefined
          ? 'Capture is running until the target exits or Lanterna is stopped...'
          : `Capture is running for ${Math.round(options.durationMs)}ms...`,
    });

    await waitForStop(connected, options);

    const kindsData: Record<string, unknown> = {};
    for (const { kind, probe } of probeInstances) {
      try {
        kindsData[kind.id] = await probe.stop(cdp);
      } catch (error) {
        logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to stop');
        recordCaptureDiagnostic(captureIntegrity, {
          stage: 'probe-stop',
          kindId: kind.id,
          message: captureDiagnosticMessage(error),
        });
      }
    }

    const durationMs = performance.now() - startedAtHr;

    const live: LiveSourceSignals = connected.drainLiveSignals?.() ?? {
      gcEventsAbs: [],
      eventLoopSamplesAbs: [],
      eventLoopAvailable: false,
    };
    session.appCompleted = Boolean(live.appCompleted);

    const eventLoopRead: EventLoopReadResult = cdp.closed
      ? { samples: [], available: false }
      : await withTimeout(readEventLoopSamples(cdp), 1500, { samples: [], available: false });

    const gcEventsViaCdp: RawGcEvent[] = cdp.closed
      ? []
      : await withTimeout(readGcEvents(cdp), 1500, [] as RawGcEvent[]);

    const absoluteEventLoopSamples = mergeTimedSamples(
      live.eventLoopSamplesAbs,
      eventLoopRead.samples,
    );
    const absoluteGcEvents = dedupeTimedEvents([...live.gcEventsAbs, ...gcEventsViaCdp]);

    if (!captureIntegrity.eventLoopTimed && absoluteEventLoopSamples.length > 0) {
      captureIntegrity.eventLoopTimed = true;
    }
    if (!captureIntegrity.gcTimed && absoluteGcEvents.length > 0) {
      captureIntegrity.gcTimed = true;
    }
    const runtimeIntegrity = cdp.closed
      ? undefined
      : await withTimeout(readRuntimeIntegrity(cdp), 1500, undefined);
    mergeCaptureIntegrityCounters(captureIntegrity, live.integrityCounters ?? runtimeIntegrity);

    const cpuData = kindsData.cpu as
      | { cpuProfile?: { samples?: number[]; timeDeltas?: number[] } }
      | undefined;
    if (
      cpuData?.cpuProfile?.samples?.length &&
      cpuData.cpuProfile.timeDeltas?.length === cpuData.cpuProfile.samples.length
    ) {
      captureIntegrity.cpuSamplesTimed = true;
    }

    const normalizedGcEvents = normalizeTimedEvents(
      absoluteGcEvents,
      runtimeCaptureStartMs,
      durationMs,
    );
    const normalizedEventLoopSamples = normalizeTimedEvents(
      absoluteEventLoopSamples,
      runtimeCaptureStartMs,
      durationMs,
    );
    const resolvedEventLoopResolutionMs = eventLoopRead.resolutionMs ?? live.eventLoopResolutionMs;
    const eventLoopHistogram = resolveEventLoopHistogram(
      eventLoopRead,
      normalizedEventLoopSamples,
      resolvedEventLoopResolutionMs,
    );

    await session.closeCdp();

    const runtimeSignals: RuntimeSignalsData = {
      gcEvents: normalizedGcEvents,
      eventLoopSamples: normalizedEventLoopSamples,
      eventLoopHistogram,
      eventLoopResolutionMs: resolvedEventLoopResolutionMs,
      eventLoopAvailable:
        live.eventLoopAvailable || eventLoopRead.available || normalizedEventLoopSamples.length > 0,
    };

    await session.finalize({ suppressErrors: false });

    return {
      target: { ...target, pid: target.pid ?? connected.target.pid },
      startedAtEpoch: connected.startedAtEpoch,
      durationMs,
      captureIntegrity,
      runtimeSignals,
      kinds: kindsData as CaptureBundle['kinds'],
    };
  } finally {
    await session.cleanup();
  }
}

class CaptureSession {
  appCompleted = false;
  private cdpClosed = false;
  private finalized = false;

  constructor(private readonly connected: ConnectedSource) {}

  async closeCdp(): Promise<void> {
    if (this.cdpClosed) return;
    this.cdpClosed = true;
    try {
      await this.connected.cdp.close();
    } catch (error) {
      recordCaptureDiagnostic(this.connected.initialIntegrity, {
        stage: 'finalize',
        message: `failed to close CDP connection: ${captureDiagnosticMessage(error)}`,
      });
    }
  }

  async finalize(options: { suppressErrors: boolean }): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    try {
      await this.connected.finalize({ appCompleted: this.appCompleted });
    } catch (error) {
      recordCaptureDiagnostic(this.connected.initialIntegrity, {
        stage: 'finalize',
        message: captureDiagnosticMessage(error),
      });
      if (!options.suppressErrors) throw error;
    }
  }

  async cleanup(): Promise<void> {
    await this.closeCdp();
    await this.finalize({ suppressErrors: true });
  }
}

function emitCaptureProgress(
  sourceOptions: unknown,
  event: { stage: 'start-capture' | 'capture-running'; message: string },
): void {
  if (!sourceOptions || typeof sourceOptions !== 'object') return;
  const onProgress = (sourceOptions as { onProgress?: unknown }).onProgress;
  if (typeof onProgress !== 'function') return;
  onProgress(event);
}

async function waitForStop<TOptions>(
  connected: ConnectedSource,
  options: RunCaptureOptions<TOptions>,
): Promise<'exit' | 'timeout' | 'signal'> {
  const promises: Array<Promise<'exit' | 'timeout' | 'signal'>> = [
    connected.waitForExit().then<'exit'>(() => 'exit'),
  ];
  if (options.durationMs !== undefined) {
    promises.push(sleep(options.durationMs).then<'timeout'>(() => 'timeout'));
  }
  if (options.stopSignal) {
    promises.push(options.stopSignal.then<'signal'>(() => 'signal'));
  }
  return Promise.race(promises);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), sleep(timeoutMs).then(() => fallback)]);
}

function resolveEventLoopHistogram(
  eventLoopRead: EventLoopReadResult,
  normalizedEventLoopSamples: EventLoopSample[],
  resolutionMs: number | undefined,
): EventLoopHistogram | undefined {
  if (isUsableEventLoopSummary(eventLoopRead.summary, resolutionMs ?? 20)) {
    return eventLoopRead.summary;
  }
  return summarizeEventLoop(normalizedEventLoopSamples);
}

function dedupeTimedEvents(events: RawGcEvent[]): RawGcEvent[] {
  const byKey = new Map<string, RawGcEvent>();
  for (const event of events) {
    const key = `${event.atMs.toFixed(3)}|${event.kind}|${event.durationMs.toFixed(3)}`;
    byKey.set(key, event);
  }
  return [...byKey.values()];
}

export function createManualStopSignal(): { trigger: () => void; promise: Promise<void> } {
  let trigger = () => {};
  const promise = new Promise<void>((resolve) => {
    trigger = resolve;
  });
  return { trigger, promise };
}
