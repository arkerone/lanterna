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
    await options.beforeCaptureStart?.();

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
      const probe = kind.createProbe();
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
        if (probe.progressMessages?.start) {
          emitCaptureProgress(options.sourceOptions, {
            stage: 'start-capture',
            message: probe.progressMessages.start,
          });
        }
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

    await options.onCaptureStarted?.();

    emitCaptureProgress(options.sourceOptions, {
      stage: 'capture-running',
      message:
        options.durationMs === undefined
          ? 'Capture is running until the target exits or Lanterna is stopped...'
          : `Capture is running for ${Math.round(options.durationMs)}ms...`,
    });

    const stopReason = await waitForStop(connected, options);
    emitCaptureProgress(options.sourceOptions, {
      stage: 'finalize-capture',
      message: 'Stopping the profiler and collecting the final samples...',
    });

    const kindsData: Record<string, unknown> = {};
    for (const { kind, probe } of probeInstances) {
      try {
        const stopTimeoutMs = probe.stopTimeoutMs ?? PROBE_STOP_TIMEOUT_MS;
        if (probe.progressMessages?.stop && stopReason !== 'signal') {
          emitCaptureProgress(options.sourceOptions, {
            stage: 'finalize-capture',
            message: probe.progressMessages.stop,
          });
        }
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
        if (!result.ok) {
          recordCaptureDiagnostic(captureIntegrity, {
            stage: 'probe-stop',
            kindId: kind.id,
            message: `timed out stopping ${kind.id} probe after ${stopTimeoutMs}ms`,
          });
          continue;
        }
        kindsData[kind.id] = result.value;
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
