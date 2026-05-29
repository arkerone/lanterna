import type { CaptureBundle, EventLoopSample } from '../../capture/core/types.js';
import type {
  EventLoopReport,
  MeasurementBasis,
  MeasurementConfidence,
} from '../../report/types.js';
import { EVENT_LOOP_STALL_INTERVAL_MS, HEARTBEAT_RESOLUTION_MS } from '../../shared/config.js';
import { percentile } from '../../shared/percentile.js';

/**
 * Narrow view over a {@link CaptureBundle} that the event-loop report needs.
 */
interface EventLoopInput {
  captureIntegrity: CaptureBundle['captureIntegrity'];
  durationMs: number;
  runtimeSignals: CaptureBundle['runtimeSignals'];
}

export function buildEventLoopReport(input: EventLoopInput): EventLoopReport {
  const samples = input.runtimeSignals.eventLoopSamples;
  const rawHistogram = input.runtimeSignals.eventLoopHistogram;
  const hasTimedHeartbeats = input.captureIntegrity.eventLoopTimed && samples.length > 0;
  const histogram = rawHistogram
    ? {
        maxLagMs: rawHistogram.maxMs,
        p99LagMs: rawHistogram.p99Ms,
        p50LagMs: rawHistogram.p50Ms,
        meanLagMs: rawHistogram.meanMs,
      }
    : undefined;
  const measurementBasis = deriveMeasurementBasis(hasTimedHeartbeats, Boolean(histogram));
  const confidence = deriveMeasurementConfidence(measurementBasis);

  if (measurementBasis === 'none') {
    return {
      maxLagMs: 0,
      p99LagMs: 0,
      p50LagMs: 0,
      meanLagMs: 0,
      sampleCount: 0,
      stallIntervals: [],
      available: false,
      measurementBasis,
      confidence,
    };
  }

  const heartbeatSummary = hasTimedHeartbeats ? summarizeHeartbeatLag(input) : undefined;
  const metrics = histogram ??
    heartbeatSummary ?? { maxLagMs: 0, p99LagMs: 0, p50LagMs: 0, meanLagMs: 0 };

  return {
    maxLagMs: metrics.maxLagMs,
    p99LagMs: metrics.p99LagMs,
    p50LagMs: metrics.p50LagMs,
    meanLagMs: metrics.meanLagMs,
    sampleCount: samples.length,
    stallIntervals: hasTimedHeartbeats
      ? deriveStallIntervals(
          input,
          input.runtimeSignals.eventLoopResolutionMs ?? HEARTBEAT_RESOLUTION_MS,
        )
      : [],
    available: true,
    measurementBasis,
    confidence,
    histogram,
  };
}

function deriveStallIntervals(
  input: EventLoopInput,
  resolutionMs: number,
): EventLoopReport['stallIntervals'] {
  return buildEventLoopStallWindows(
    input.runtimeSignals.eventLoopSamples,
    input.durationMs,
    resolutionMs,
  );
}

/**
 * Pure stall-window builder shared by the event-loop report and async
 * latency cause-classification. A stall window is `[atMs - lagMs, atMs]` for
 * every sample whose lag crosses `thresholdMs`, plus a trailing-lag window
 * when the loop was still stalled at capture end, then merged.
 */
export function buildEventLoopStallWindows(
  samples: readonly EventLoopSample[],
  durationMs: number,
  resolutionMs: number,
  thresholdMs: number = EVENT_LOOP_STALL_INTERVAL_MS,
): EventLoopReport['stallIntervals'] {
  const intervals: EventLoopReport['stallIntervals'] = [];

  for (const sample of samples) {
    if (sample.lagMs < thresholdMs) continue;
    intervals.push({
      startMs: Math.max(0, sample.atMs - sample.lagMs),
      endMs: sample.atMs,
      maxLagMs: sample.lagMs,
    });
  }

  const lastSampleAtMs = samples[samples.length - 1]?.atMs;
  if (lastSampleAtMs !== undefined) {
    const trailingLagMs = Math.max(0, durationMs - lastSampleAtMs - resolutionMs);
    if (trailingLagMs >= thresholdMs) {
      intervals.push({
        startMs: Math.max(0, lastSampleAtMs + resolutionMs),
        endMs: durationMs,
        maxLagMs: trailingLagMs,
      });
    }
  }

  return mergeIntervals(intervals);
}

function summarizeHeartbeatLag(input: EventLoopInput):
  | {
      maxLagMs: number;
      p99LagMs: number;
      p50LagMs: number;
      meanLagMs: number;
    }
  | undefined {
  const samples = input.runtimeSignals.eventLoopSamples;
  const trailingLagMs = inferTrailingLag(input);
  const lagValues = samples.map((sample) => sample.lagMs);
  if (trailingLagMs > 0) lagValues.push(trailingLagMs);
  lagValues.sort((left, right) => left - right);
  if (lagValues.length === 0) return undefined;

  return {
    maxLagMs: lagValues[lagValues.length - 1] ?? 0,
    p99LagMs: percentile(lagValues, 0.99),
    p50LagMs: percentile(lagValues, 0.5),
    meanLagMs: lagValues.reduce((sum, value) => sum + value, 0) / lagValues.length,
  };
}

function inferTrailingLag(input: EventLoopInput): number {
  const samples = input.runtimeSignals.eventLoopSamples;
  const lastSampleAtMs = samples[samples.length - 1]?.atMs;
  const resolutionMs = input.runtimeSignals.eventLoopResolutionMs ?? HEARTBEAT_RESOLUTION_MS;
  if (lastSampleAtMs === undefined) return 0;
  return Math.max(0, input.durationMs - lastSampleAtMs - resolutionMs);
}

function deriveMeasurementBasis(hasHeartbeats: boolean, hasHistogram: boolean): MeasurementBasis {
  if (hasHeartbeats && hasHistogram) return 'both';
  if (hasHeartbeats) return 'heartbeats';
  if (hasHistogram) return 'histogram';
  return 'none';
}

function deriveMeasurementConfidence(basis: MeasurementBasis): MeasurementConfidence {
  if (basis === 'none') return 'none';
  if (basis === 'histogram') return 'low';
  return 'high';
}

function mergeIntervals(
  intervals: EventLoopReport['stallIntervals'],
): EventLoopReport['stallIntervals'] {
  if (intervals.length === 0) return [];
  const sortedIntervals = [...intervals].sort((left, right) => left.startMs - right.startMs);
  const merged: EventLoopReport['stallIntervals'] = [];

  for (const interval of sortedIntervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.startMs > previous.endMs + 1) {
      merged.push({ ...interval });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, interval.endMs);
    previous.maxLagMs = Math.max(previous.maxLagMs, interval.maxLagMs);
  }

  return merged;
}
