import type { RawCapture } from '../../capture/core/types.js';
import type {
  EventLoopReport,
  MeasurementBasis,
  MeasurementConfidence,
} from '../../report/types.js';
import { EVENT_LOOP_STALL_INTERVAL_MS, HEARTBEAT_RESOLUTION_MS } from '../../shared/config.js';
import { percentile } from '../../shared/percentile.js';

export function buildEventLoopReport(raw: RawCapture): EventLoopReport {
  const hasTimedHeartbeats = raw.captureIntegrity.eventLoopTimed && raw.eventLoopSamples.length > 0;
  const histogram = raw.eventLoopHistogram
    ? {
        maxLagMs: raw.eventLoopHistogram.maxMs,
        p99LagMs: raw.eventLoopHistogram.p99Ms,
        p50LagMs: raw.eventLoopHistogram.p50Ms,
        meanLagMs: raw.eventLoopHistogram.meanMs,
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

  const heartbeatSummary = hasTimedHeartbeats ? summarizeHeartbeatLag(raw) : undefined;
  const metrics = histogram ??
    heartbeatSummary ?? {
      maxLagMs: 0,
      p99LagMs: 0,
      p50LagMs: 0,
      meanLagMs: 0,
    };

  return {
    maxLagMs: metrics.maxLagMs,
    p99LagMs: metrics.p99LagMs,
    p50LagMs: metrics.p50LagMs,
    meanLagMs: metrics.meanLagMs,
    sampleCount: raw.eventLoopSamples.length,
    stallIntervals: hasTimedHeartbeats
      ? deriveStallIntervals(raw, raw.eventLoopResolutionMs ?? HEARTBEAT_RESOLUTION_MS)
      : [],
    available: true,
    measurementBasis,
    confidence,
    histogram,
  };
}

function deriveStallIntervals(
  raw: RawCapture,
  resolutionMs: number,
): EventLoopReport['stallIntervals'] {
  const intervals: EventLoopReport['stallIntervals'] = [];

  for (const sample of raw.eventLoopSamples) {
    if (sample.lagMs < EVENT_LOOP_STALL_INTERVAL_MS) continue;
    intervals.push({
      startMs: Math.max(0, sample.atMs - sample.lagMs),
      endMs: sample.atMs,
      maxLagMs: sample.lagMs,
    });
  }

  const trailingLagMs = inferTrailingLag(raw);
  if (trailingLagMs >= EVENT_LOOP_STALL_INTERVAL_MS) {
    const lastSampleAtMs = raw.eventLoopSamples[raw.eventLoopSamples.length - 1]?.atMs ?? 0;
    intervals.push({
      startMs: Math.max(0, lastSampleAtMs + resolutionMs),
      endMs: raw.durationMs,
      maxLagMs: trailingLagMs,
    });
  }

  return mergeIntervals(intervals);
}

function summarizeHeartbeatLag(raw: RawCapture):
  | {
      maxLagMs: number;
      p99LagMs: number;
      p50LagMs: number;
      meanLagMs: number;
    }
  | undefined {
  const trailingLagMs = inferTrailingLag(raw);
  const lagValues = raw.eventLoopSamples.map((sample) => sample.lagMs);
  if (trailingLagMs > 0) {
    lagValues.push(trailingLagMs);
  }
  lagValues.sort((left, right) => left - right);
  if (lagValues.length === 0) return undefined;

  return {
    maxLagMs: lagValues[lagValues.length - 1] ?? 0,
    p99LagMs: percentile(lagValues, 0.99),
    p50LagMs: percentile(lagValues, 0.5),
    meanLagMs: lagValues.reduce((sum, value) => sum + value, 0) / lagValues.length,
  };
}

function inferTrailingLag(raw: RawCapture): number {
  const lastSampleAtMs = raw.eventLoopSamples[raw.eventLoopSamples.length - 1]?.atMs;
  const resolutionMs = raw.eventLoopResolutionMs ?? HEARTBEAT_RESOLUTION_MS;
  if (lastSampleAtMs === undefined) return 0;
  return Math.max(0, raw.durationMs - lastSampleAtMs - resolutionMs);
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
