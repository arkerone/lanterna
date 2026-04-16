import type { CdpClient } from '../../inspector/client.js';
import { fetchTargetInfo, markCaptureStart, readRuntimeClockNow } from '../../inspector/runtime.js';
import {
  type EventLoopReadResult,
  readEventLoopSamples,
} from '../../runtime-signals/readers/event-loop.js';
import { startCpuMeasure, stopCpuMeasure } from './cpu.js';
import {
  hasTimedCpuSamples,
  isUsableEventLoopSummary,
  mergeTimedSamples,
  normalizeTimedEvents,
  summarizeEventLoop,
} from './timed-signals.js';
import type {
  CaptureIntegrity,
  EventLoopHistogram,
  EventLoopSample,
  RawCapture,
  RawDeopt,
  RawGcEvent,
  TargetInfo,
} from './types.js';

export interface StartedCaptureSession {
  cdp: CdpClient;
  target: TargetInfo;
  startedAtEpoch: number;
  startedAtHr: number;
  runtimeCaptureStartMs: number;
}

export interface FinishCaptureSessionOptions {
  session: StartedCaptureSession;
  captureIntegrity: CaptureIntegrity;
  gcEventsAbs: RawGcEvent[];
  eventLoopSamplesAbs?: EventLoopSample[];
  eventLoopRead?: EventLoopReadResult;
  eventLoopAvailable: boolean;
  eventLoopResolutionMs?: number;
  deopts?: RawDeopt[];
}

export async function startCaptureSession(
  cdp: CdpClient,
  sampleIntervalMicros: number,
  targetFallback: Partial<Pick<TargetInfo, 'pid'>> = {},
): Promise<StartedCaptureSession> {
  const target = await fetchTargetInfo(cdp, targetFallback);
  const startedAtEpoch = Date.now();
  const startedAtHr = performance.now();

  await markCaptureStart(cdp);
  const runtimeCaptureStartMs = await readRuntimeClockNow(cdp);
  await startCpuMeasure(cdp, sampleIntervalMicros);

  return {
    cdp,
    target,
    startedAtEpoch,
    startedAtHr,
    runtimeCaptureStartMs,
  };
}

export async function finishCaptureSession(
  options: FinishCaptureSessionOptions,
): Promise<RawCapture> {
  const {
    session,
    captureIntegrity,
    gcEventsAbs,
    eventLoopAvailable,
    eventLoopResolutionMs,
    deopts = [],
  } = options;

  const durationMs = performance.now() - session.startedAtHr;
  const eventLoopRead = options.eventLoopRead ?? (await readEventLoopSamples(session.cdp));
  const absoluteEventLoopSamples = mergeTimedSamples(
    options.eventLoopSamplesAbs ?? [],
    eventLoopRead.samples,
  );

  if (!captureIntegrity.eventLoopTimed && absoluteEventLoopSamples.length > 0) {
    captureIntegrity.eventLoopTimed = true;
  }

  const normalizedGcEvents = normalizeTimedEvents(
    gcEventsAbs,
    session.runtimeCaptureStartMs,
    durationMs,
  );
  const normalizedEventLoopSamples = normalizeTimedEvents(
    absoluteEventLoopSamples,
    session.runtimeCaptureStartMs,
    durationMs,
  );

  let cpuProfile: Awaited<ReturnType<typeof stopCpuMeasure>>;
  try {
    cpuProfile = await stopCpuMeasure(session.cdp);
  } catch (error) {
    throw new Error(`failed to stop CPU profile: ${(error as Error).message}`);
  }

  captureIntegrity.cpuSamplesTimed = hasTimedCpuSamples(cpuProfile);

  const resolvedEventLoopResolutionMs = eventLoopRead.resolutionMs ?? eventLoopResolutionMs;
  const eventLoopHistogram = resolveEventLoopHistogram(
    eventLoopRead,
    normalizedEventLoopSamples,
    resolvedEventLoopResolutionMs,
  );

  await session.cdp.close().catch(() => {});

  return {
    target: session.target,
    startedAtEpoch: session.startedAtEpoch,
    durationMs,
    cpuProfile,
    gcEvents: normalizedGcEvents,
    eventLoopSamples: normalizedEventLoopSamples,
    eventLoopHistogram,
    eventLoopResolutionMs: resolvedEventLoopResolutionMs,
    eventLoopAvailable:
      eventLoopAvailable || eventLoopRead.available || normalizedEventLoopSamples.length > 0,
    captureIntegrity,
    deopts,
  };
}

export function createCaptureIntegrity(
  overrides: Partial<CaptureIntegrity> = {},
): CaptureIntegrity {
  return {
    controlChannel: false,
    eventLoopTimed: false,
    gcTimed: false,
    cpuSamplesTimed: false,
    ...overrides,
  };
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
