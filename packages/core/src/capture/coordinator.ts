import {
  disposeRuntime,
  fetchTargetInfo,
  markCaptureStart,
  readRuntimeClockNow,
  startRuntimeKeepalive,
} from '../inspector/runtime.js';
import type { ProfileKind } from '../kinds/core/types.js';
import { composeAttachScript, composePreloadScript } from '../runtime-signals/hooks/framework.js';
import { runtimeSignalsInstaller } from '../runtime-signals/hooks/installers/runtime-signals.js';
import {
  type EventLoopReadResult,
  readEventLoopSamples,
} from '../runtime-signals/readers/event-loop.js';
import { readGcEvents } from '../runtime-signals/readers/gc.js';
import { readRuntimeIntegrity } from '../runtime-signals/readers/integrity.js';
import { HEARTBEAT_RESOLUTION_MS, RUNTIME_HOOK_KEEPALIVE_INTERVAL_MS } from '../shared/config.js';
import { withTimeoutResult } from '../shared/timeout.js';
import { PeriodicSignalDrain } from './coordinator/periodic-drain.js';
import { ProbeOrchestrator } from './coordinator/probes.js';
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
  TargetCrashInfo,
  TargetExitInfo,
} from './core/types.js';

export { createManualStopSignal } from './coordinator/stop-handling.js';

import { waitForStop } from './coordinator/stop-handling.js';

interface RuntimeSignalCollectionInput {
  cdp: RunCaptureConnectedSession['cdp'];
  connected: RunCaptureConnectedSession;
  session: CaptureSession;
  captureIntegrity: CaptureIntegrity;
  runtimeCaptureStartMs: number;
  durationMs: number;
  periodicDrain?: PeriodicSignalDrain;
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
  /**
   * Overrides the periodic mid-capture drain cadence (attach/in-process
   * mode). Internal — not exposed on the CLI; tests use it to shrink the
   * interval so drain behavior is verifiable without waiting out the real
   * {@link PERIODIC_DRAIN_INTERVAL_MS}.
   */
  periodicDrainIntervalMs?: number;
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
  let stopKeepalive: (() => void) | undefined;
  let periodicDrain: PeriodicSignalDrain | undefined;

  try {
    const target = await fetchTargetInfo(cdp, { pid: connected.target.pid });
    await markCaptureStart(cdp);
    stopKeepalive = startRuntimeKeepalive(cdp, RUNTIME_HOOK_KEEPALIVE_INTERVAL_MS);
    const clockReadStartHr = performance.now();
    const runtimeCaptureStartMs = await readRuntimeClockNow(cdp);
    const cdpClockJitterMs = (performance.now() - clockReadStartHr) / 2;
    const startedAtHr = performance.now();
    emitCaptureProgress(options.sourceOptions, {
      stage: 'start-capture',
      message: 'Runtime capture clock started. Starting profile probes...',
    });

    const probes = new ProbeOrchestrator({
      cdp,
      mode: connected.mode,
      captureIntegrity,
      sourceOptions: options.sourceOptions,
      ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
    });
    await probes.install(options.kinds);
    await probes.start();
    // Fail-fast: a capture where every probe failed would otherwise complete
    // "successfully" with an empty report and only buried diagnostics.
    if (options.kinds.length > 0 && !probes.hasStartedProbes) {
      await probes.disposeAll('signal');
      throw new Error(
        `capture failed: no profile probe could be installed and started (${summarizeProbeDiagnostics(captureIntegrity)})`,
      );
    }
    await connected.releaseRuntime?.();
    // Probe work that needs the isolate to run (e.g. the start heap snapshot)
    // happens here, once `--inspect-brk` has been released, never before.
    await probes.afterRuntimeReleased();

    await options.beforeCaptureStart?.();

    await options.onCaptureStarted?.();

    emitCaptureProgress(options.sourceOptions, {
      stage: 'capture-running',
      message: captureRunningMessage(options.durationMs),
    });

    // Spawn already streams every signal live over the control channel; the
    // periodic drain only earns its keep in attach/in-process mode, where the
    // in-target buffers would otherwise be read exactly once, at stop.
    if (connected.mode !== 'spawn') {
      periodicDrain = new PeriodicSignalDrain(
        cdp,
        probes,
        captureIntegrity,
        options.periodicDrainIntervalMs,
      );
      periodicDrain.start();
    }

    const stopReason = await waitForStop(connected, options);
    // Stop draining before probe.stop(): some probes' stop steps (e.g. the
    // final memory heap snapshot) block the isolate for seconds, and a drain
    // tick racing that would just time out for no benefit.
    await periodicDrain?.stop();
    emitCaptureProgress(options.sourceOptions, {
      stage: 'finalize-capture',
      message: 'Stopping the profiler and collecting the final samples...',
    });

    // Freeze the capture window before stopping probes: probe stop can take
    // seconds (final heap snapshot has no timeout) and must not inflate
    // durationMs, which feeds rate thresholds and impact estimates downstream.
    const durationMs = performance.now() - startedAtHr;
    const kindsData = await probes.stop(connected, stopReason);

    const { runtimeSignals, targetExit, targetCrash } = await collectRuntimeSignals({
      cdp,
      connected,
      session,
      captureIntegrity,
      runtimeCaptureStartMs,
      durationMs,
      periodicDrain,
    });
    await disposeRuntimeBestEffort(cdp, captureIntegrity);

    await session.closeCdp();

    await session.finalize({ suppressErrors: false });

    // The exit status often lands only during finalize (the control channel's
    // app-complete event races ahead of the OS-level exit event), so read the
    // live signals once more now that the source has waited for the child.
    const finalLiveSignals = connected.drainLiveSignals?.();
    const finalTargetExit = targetExit ?? finalLiveSignals?.targetExit;
    const finalTargetCrash = targetCrash ?? finalLiveSignals?.targetCrash;

    return {
      target: { ...target, pid: target.pid ?? connected.target.pid },
      startedAtEpoch: connected.startedAtEpoch,
      durationMs,
      captureIntegrity,
      runtimeSignals,
      cdpClockJitterMs,
      kinds: kindsData as CaptureBundle['kinds'],
      ...(finalTargetExit ? { targetExit: finalTargetExit } : {}),
      ...(finalTargetCrash ? { targetCrash: finalTargetCrash } : {}),
    };
  } finally {
    // Idempotent safety net: the normal path already stops the drain right
    // after `waitForStop` resolves; this only matters if something earlier
    // in the try block threw before reaching that point.
    await periodicDrain?.stop();
    stopKeepalive?.();
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

function summarizeProbeDiagnostics(captureIntegrity: CaptureIntegrity): string {
  const probeDiagnostics = (captureIntegrity.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.stage === 'probe-install' || diagnostic.stage === 'probe-start',
  );
  if (probeDiagnostics.length === 0) return 'no diagnostics recorded';
  return probeDiagnostics
    .map((diagnostic) => `${diagnostic.kindId ?? 'unknown kind'}: ${diagnostic.message}`)
    .join('; ');
}

async function disposeRuntimeBestEffort(
  cdp: RunCaptureConnectedSession['cdp'],
  captureIntegrity: CaptureIntegrity,
): Promise<void> {
  try {
    await disposeRuntime(cdp);
  } catch (error) {
    recordCaptureDiagnostic(captureIntegrity, {
      stage: 'runtime-dispose',
      message: captureDiagnosticMessage(error),
    });
  }
}

async function collectRuntimeSignals({
  cdp,
  connected,
  session,
  captureIntegrity,
  runtimeCaptureStartMs,
  durationMs,
  periodicDrain,
}: RuntimeSignalCollectionInput): Promise<{
  runtimeSignals: RuntimeSignalsData;
  targetExit?: TargetExitInfo;
  targetCrash?: TargetCrashInfo;
}> {
  const live = drainLiveSourceSignals(connected);
  session.appCompleted = Boolean(live.appCompleted);
  const drained = periodicDrain?.accumulated();

  const eventLoopRead = await readEventLoopSignals(cdp, captureIntegrity);
  const gcEventsViaCdp = await readGcSignals(cdp, captureIntegrity);
  const absoluteEventLoopSamples = mergeTimedSamples(
    [...live.eventLoopSamplesAbs, ...(drained?.eventLoopSamplesAbs ?? [])],
    eventLoopRead.samples,
  );
  const absoluteGcEvents = dedupeTimedEvents([
    ...live.gcEventsAbs,
    ...(drained?.gcEventsAbs ?? []),
    ...gcEventsViaCdp,
  ]);

  markTimedSignalsAvailable(captureIntegrity, absoluteEventLoopSamples, absoluteGcEvents);
  await mergeRuntimeIntegrity(cdp, captureIntegrity, live);

  const normalizedEventLoopSamples = normalizeTimedEvents(
    absoluteEventLoopSamples,
    runtimeCaptureStartMs,
    durationMs,
  );
  const resolvedEventLoopResolutionMs = eventLoopRead.resolutionMs ?? live.eventLoopResolutionMs;

  return {
    runtimeSignals: {
      gcEvents: normalizeTimedEvents(absoluteGcEvents, runtimeCaptureStartMs, durationMs),
      eventLoopSamples: normalizedEventLoopSamples,
      eventLoopHistogram: resolveEventLoopHistogram(
        eventLoopRead,
        normalizedEventLoopSamples,
        resolvedEventLoopResolutionMs,
      ),
      eventLoopResolutionMs: resolvedEventLoopResolutionMs,
      eventLoopAvailable: hasRuntimeEventLoopSignals(
        live,
        eventLoopRead,
        normalizedEventLoopSamples,
      ),
    },
    ...(live.targetExit ? { targetExit: live.targetExit } : {}),
    ...(live.targetCrash ? { targetCrash: live.targetCrash } : {}),
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

const RUNTIME_READ_TIMEOUT_MS = 1500;

async function readEventLoopSignals(
  cdp: RunCaptureConnectedSession['cdp'],
  captureIntegrity: CaptureIntegrity,
): Promise<EventLoopReadResult> {
  if (cdp.closed) return { samples: [], available: false };
  const result = await withTimeoutResult(readEventLoopSamples(cdp), RUNTIME_READ_TIMEOUT_MS);
  if (result.ok) return result.value;
  recordCaptureDiagnostic(captureIntegrity, {
    stage: 'runtime-read',
    message: `timed out reading event-loop samples after ${RUNTIME_READ_TIMEOUT_MS}ms`,
  });
  return { samples: [], available: false };
}

async function readGcSignals(
  cdp: RunCaptureConnectedSession['cdp'],
  captureIntegrity: CaptureIntegrity,
): Promise<RawGcEvent[]> {
  if (cdp.closed) return [];
  const result = await withTimeoutResult(readGcEvents(cdp), RUNTIME_READ_TIMEOUT_MS);
  if (result.ok) return result.value;
  recordCaptureDiagnostic(captureIntegrity, {
    stage: 'runtime-read',
    message: `timed out reading GC events after ${RUNTIME_READ_TIMEOUT_MS}ms`,
  });
  return [];
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
  let runtimeIntegrity: Awaited<ReturnType<typeof readRuntimeIntegrity>> | undefined;
  if (!cdp.closed) {
    const result = await withTimeoutResult(readRuntimeIntegrity(cdp), RUNTIME_READ_TIMEOUT_MS);
    if (result.ok) {
      runtimeIntegrity = result.value;
    } else if (!live.integrityCounters) {
      // Only worth a diagnostic when nothing else will supply these
      // counters — the live control channel already covers spawn mode.
      recordCaptureDiagnostic(captureIntegrity, {
        stage: 'runtime-read',
        message: `timed out reading runtime integrity counters after ${RUNTIME_READ_TIMEOUT_MS}ms`,
      });
    }
  }
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
