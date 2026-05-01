import { fetchTargetInfo, markCaptureStart, readRuntimeClockNow } from '../inspector/runtime.js';
import type { ProfileKind } from '../kinds/core/types.js';
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
import { emitCaptureProgress } from './coordinator/progress.js';
import { dedupeTimedEvents, resolveEventLoopHistogram } from './coordinator/runtime-signals.js';
import { CaptureSession } from './coordinator/session-cleanup.js';
import {
  captureDiagnosticMessage,
  mergeCaptureIntegrityCounters,
  recordCaptureDiagnostic,
} from './core/session.js';
import { mergeTimedSamples, normalizeTimedEvents } from './core/timed-signals.js';
import type {
  CaptureBundle,
  CaptureIntegrity,
  ConnectedSource,
  LiveSourceSignals,
  PreloadContribution,
  ProfileSource,
  RawGcEvent,
  RuntimeSignalsData,
} from './core/types.js';

export { createManualStopSignal } from './coordinator/stop-handling.js';

import { waitForStop } from './coordinator/stop-handling.js';
import { withTimeout, withTimeoutResult } from './coordinator/timeouts.js';

const PROBE_STOP_TIMEOUT_MS = 5000;

type ProbeInstance = {
  kind: ProfileKind;
  probe: ReturnType<ProfileKind['createProbe']>;
};

type StopReason = 'exit' | 'timeout' | 'signal';

interface RuntimeSignalCollectionInput {
  cdp: RunCaptureConnectedSession['cdp'];
  connected: RunCaptureConnectedSession;
  session: CaptureSession;
  captureIntegrity: CaptureIntegrity;
  runtimeCaptureStartMs: number;
  durationMs: number;
}

type RunCaptureConnectedSession = ConnectedSource;

export interface RunCaptureOptions<TSourceOptions> {
  source: ProfileSource<TSourceOptions>;
  sourceOptions: TSourceOptions;
  kinds: ProfileKind[];
  /** Duration of the capture (ms). Omit to run until exit / manual stop. */
  durationMs?: number;
  /** External stop signal. When it resolves, the coordinator stops. */
  stopSignal?: Promise<void>;
  /** Optional abort signal for interrupting finalization after stop has begun. */
  abortSignal?: AbortSignal;
  /** Optional hook after the target is running but before the capture clock starts. */
  beforeCaptureStart?: () => void | Promise<void>;
  /** Optional hook after probes start, before waiting for capture completion. */
  onCaptureStarted?: () => void | Promise<void>;
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
  const preload = composeCapturePreload(options.kinds);
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

    const probeInstances = await installProbes(options.kinds, cdp, captureIntegrity);
    await startProbes(probeInstances, cdp, options, captureIntegrity);
    await connected.releaseRuntime?.();

    await options.beforeCaptureStart?.();

    await options.onCaptureStarted?.();

    emitCaptureProgress(options.sourceOptions, {
      stage: 'capture-running',
      message: captureRunningMessage(options.durationMs),
    });

    const stopReason = await waitForStop(connected, options);
    emitCaptureProgress(options.sourceOptions, {
      stage: 'finalize-capture',
      message: 'Stopping the profiler and collecting the final samples...',
    });

    const kindsData = await stopProbes(probeInstances, cdp, options, captureIntegrity, stopReason);
    const durationMs = performance.now() - startedAtHr;

    const runtimeSignals = await collectRuntimeSignals({
      cdp,
      connected,
      session,
      captureIntegrity,
      runtimeCaptureStartMs,
      durationMs,
    });

    await session.closeCdp();

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

function composeCapturePreload(kinds: readonly ProfileKind[]): PreloadContribution {
  const installers = [runtimeSignalsInstaller];
  for (const kind of kinds) {
    if (kind.hookInstaller) installers.push(kind.hookInstaller);
  }

  return {
    preloadScript: composePreloadScript(installers, {
      resolutionMs: HEARTBEAT_RESOLUTION_MS,
      emitLifecycle: true,
    }),
    attachScript: composeAttachScript(installers, {
      resolutionMs: HEARTBEAT_RESOLUTION_MS,
    }),
    nodeOptions: installers.flatMap((installer) => installer.nodeOptions ?? []),
    controlFd: 3,
  };
}

async function installProbes(
  kinds: readonly ProfileKind[],
  cdp: RunCaptureConnectedSession['cdp'],
  captureIntegrity: CaptureIntegrity,
): Promise<ProbeInstance[]> {
  const probeInstances: ProbeInstance[] = [];
  for (const kind of kinds) {
    const probe = kind.createProbe();
    try {
      await probe.install?.(cdp);
      probeInstances.push({ kind, probe });
    } catch (error) {
      logger.warn({ kindId: kind.id, err: error }, 'kind probe install failed');
      recordCaptureDiagnostic(captureIntegrity, {
        stage: 'probe-install',
        kindId: kind.id,
        message: captureDiagnosticMessage(error),
      });
    }
  }
  return probeInstances;
}

async function startProbes<TSourceOptions>(
  probeInstances: readonly ProbeInstance[],
  cdp: RunCaptureConnectedSession['cdp'],
  options: RunCaptureOptions<TSourceOptions>,
  captureIntegrity: CaptureIntegrity,
): Promise<void> {
  for (const { kind, probe } of probeInstances) {
    try {
      emitProbeStartProgress(options.sourceOptions, probe);
      await probe.start(cdp, { abortSignal: options.abortSignal });
    } catch (error) {
      logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to start');
      recordCaptureDiagnostic(captureIntegrity, {
        stage: 'probe-start',
        kindId: kind.id,
        message: captureDiagnosticMessage(error),
      });
    }
  }
}

function emitProbeStartProgress<TSourceOptions>(
  sourceOptions: TSourceOptions,
  probe: ProbeInstance['probe'],
): void {
  if (!probe.progressMessages?.start) return;
  emitCaptureProgress(sourceOptions, {
    stage: 'start-capture',
    message: probe.progressMessages.start,
  });
}

async function stopProbes<TSourceOptions>(
  probeInstances: readonly ProbeInstance[],
  cdp: RunCaptureConnectedSession['cdp'],
  options: RunCaptureOptions<TSourceOptions>,
  captureIntegrity: CaptureIntegrity,
  stopReason: StopReason,
): Promise<Record<string, unknown>> {
  const kindsData: Record<string, unknown> = {};
  for (const probeInstance of probeInstances) {
    const result = await stopProbe(probeInstance, cdp, options, captureIntegrity, stopReason);
    if (!result.ok) continue;
    kindsData[probeInstance.kind.id] = result.value;
  }
  return kindsData;
}

async function stopProbe<TSourceOptions>(
  { kind, probe }: ProbeInstance,
  cdp: RunCaptureConnectedSession['cdp'],
  options: RunCaptureOptions<TSourceOptions>,
  captureIntegrity: CaptureIntegrity,
  stopReason: StopReason,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const stopTimeoutMs = probe.stopTimeoutMs ?? PROBE_STOP_TIMEOUT_MS;
    emitProbeStopProgress(options.sourceOptions, probe, stopReason);
    const result =
      stopTimeoutMs === false
        ? {
            ok: true as const,
            value: await probe.stop(cdp, { abortSignal: options.abortSignal, stopReason }),
          }
        : await withTimeoutResult(
            probe.stop(cdp, { abortSignal: options.abortSignal, stopReason }),
            stopTimeoutMs,
          );

    if (result.ok) return result;

    recordCaptureDiagnostic(captureIntegrity, {
      stage: 'probe-stop',
      kindId: kind.id,
      message: `timed out stopping ${kind.id} probe after ${stopTimeoutMs}ms`,
    });
  } catch (error) {
    logger.warn({ kindId: kind.id, err: error }, 'kind probe failed to stop');
    recordCaptureDiagnostic(captureIntegrity, {
      stage: 'probe-stop',
      kindId: kind.id,
      message: captureDiagnosticMessage(error),
    });
  }
  return { ok: false };
}

function emitProbeStopProgress<TSourceOptions>(
  sourceOptions: TSourceOptions,
  probe: ProbeInstance['probe'],
  stopReason: StopReason,
): void {
  if (!probe.progressMessages?.stop || stopReason === 'signal') return;
  emitCaptureProgress(sourceOptions, {
    stage: 'finalize-capture',
    message: probe.progressMessages.stop,
  });
}

async function collectRuntimeSignals({
  cdp,
  connected,
  session,
  captureIntegrity,
  runtimeCaptureStartMs,
  durationMs,
}: RuntimeSignalCollectionInput): Promise<RuntimeSignalsData> {
  const live = drainLiveSourceSignals(connected);
  session.appCompleted = Boolean(live.appCompleted);

  const eventLoopRead = await readEventLoopSignals(cdp);
  const gcEventsViaCdp = await readGcSignals(cdp);
  const absoluteEventLoopSamples = mergeTimedSamples(
    live.eventLoopSamplesAbs,
    eventLoopRead.samples,
  );
  const absoluteGcEvents = dedupeTimedEvents([...live.gcEventsAbs, ...gcEventsViaCdp]);

  markTimedSignalsAvailable(captureIntegrity, absoluteEventLoopSamples, absoluteGcEvents);
  await mergeRuntimeIntegrity(cdp, captureIntegrity, live);

  const normalizedEventLoopSamples = normalizeTimedEvents(
    absoluteEventLoopSamples,
    runtimeCaptureStartMs,
    durationMs,
  );
  const resolvedEventLoopResolutionMs = eventLoopRead.resolutionMs ?? live.eventLoopResolutionMs;

  return {
    gcEvents: normalizeTimedEvents(absoluteGcEvents, runtimeCaptureStartMs, durationMs),
    eventLoopSamples: normalizedEventLoopSamples,
    eventLoopHistogram: resolveEventLoopHistogram(
      eventLoopRead,
      normalizedEventLoopSamples,
      resolvedEventLoopResolutionMs,
    ),
    eventLoopResolutionMs: resolvedEventLoopResolutionMs,
    eventLoopAvailable: hasRuntimeEventLoopSignals(live, eventLoopRead, normalizedEventLoopSamples),
  };
}

function drainLiveSourceSignals(connected: RunCaptureConnectedSession): LiveSourceSignals {
  return (
    connected.drainLiveSignals?.() ?? {
      gcEventsAbs: [],
      eventLoopSamplesAbs: [],
      eventLoopAvailable: false,
    }
  );
}

async function readEventLoopSignals(
  cdp: RunCaptureConnectedSession['cdp'],
): Promise<EventLoopReadResult> {
  if (cdp.closed) return { samples: [], available: false };
  return withTimeout(readEventLoopSamples(cdp), 1500, { samples: [], available: false });
}

async function readGcSignals(cdp: RunCaptureConnectedSession['cdp']): Promise<RawGcEvent[]> {
  if (cdp.closed) return [];
  return withTimeout(readGcEvents(cdp), 1500, [] as RawGcEvent[]);
}

function markTimedSignalsAvailable(
  captureIntegrity: CaptureIntegrity,
  eventLoopSamples: readonly unknown[],
  gcEvents: readonly unknown[],
): void {
  if (!captureIntegrity.eventLoopTimed && eventLoopSamples.length > 0) {
    captureIntegrity.eventLoopTimed = true;
  }
  if (!captureIntegrity.gcTimed && gcEvents.length > 0) {
    captureIntegrity.gcTimed = true;
  }
}

async function mergeRuntimeIntegrity(
  cdp: RunCaptureConnectedSession['cdp'],
  captureIntegrity: CaptureIntegrity,
  live: LiveSourceSignals,
): Promise<void> {
  const runtimeIntegrity = cdp.closed
    ? undefined
    : await withTimeout(readRuntimeIntegrity(cdp), 1500, undefined);
  mergeCaptureIntegrityCounters(captureIntegrity, live.integrityCounters ?? runtimeIntegrity);
}

function hasRuntimeEventLoopSignals(
  live: LiveSourceSignals,
  eventLoopRead: EventLoopReadResult,
  normalizedEventLoopSamples: readonly unknown[],
): boolean {
  return (
    live.eventLoopAvailable || eventLoopRead.available || normalizedEventLoopSamples.length > 0
  );
}

function captureRunningMessage(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return 'Capture is running until the target exits or Lanterna is stopped...';
  }
  return `Capture is running for ${Math.round(durationMs)}ms...`;
}
