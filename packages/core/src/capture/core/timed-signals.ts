import type { EventLoopReadResult } from '../../runtime-signals/readers/event-loop.js';
import { percentile } from '../../shared/percentile.js';
import type { EventLoopHistogram, EventLoopSample, RawCpuProfile } from './types.js';

export function summarizeEventLoop(samples: EventLoopSample[]): EventLoopHistogram | undefined {
  if (samples.length === 0) return undefined;
  const sortedLagValues = samples.map((sample) => sample.lagMs).sort((left, right) => left - right);

  return {
    maxMs: sortedLagValues[sortedLagValues.length - 1] ?? 0,
    meanMs: sortedLagValues.reduce((sum, value) => sum + value, 0) / sortedLagValues.length,
    p50Ms: percentile(sortedLagValues, 0.5),
    p99Ms: percentile(sortedLagValues, 0.99),
  };
}

export function mergeTimedSamples(
  primarySamples: EventLoopSample[],
  secondarySamples: EventLoopSample[],
): EventLoopSample[] {
  const samplesByKey = new Map<string, EventLoopSample>();
  for (const sample of [...primarySamples, ...secondarySamples]) {
    const key = `${sample.atMs.toFixed(3)}:${sample.lagMs.toFixed(3)}`;
    samplesByKey.set(key, sample);
  }
  return Array.from(samplesByKey.values());
}

export function isUsableEventLoopSummary(
  summary: EventLoopReadResult['summary'],
  resolutionMs: number,
): summary is NonNullable<EventLoopReadResult['summary']> {
  if (!summary || summary.count <= 0) return false;
  if (
    !Number.isFinite(summary.maxMs) ||
    !Number.isFinite(summary.meanMs) ||
    !Number.isFinite(summary.p50Ms) ||
    !Number.isFinite(summary.p99Ms)
  ) {
    return false;
  }

  const minimumExpectedLagMs = Math.max(1, resolutionMs / 10);
  return (
    summary.maxMs >= minimumExpectedLagMs ||
    summary.p99Ms >= minimumExpectedLagMs ||
    summary.p50Ms >= minimumExpectedLagMs
  );
}

export function normalizeTimedEvents<TEvent extends { atMs: number }>(
  events: TEvent[],
  captureStartMs: number,
  durationMs: number,
): TEvent[] {
  return events
    .map((event) => ({ ...event, atMs: Math.max(0, event.atMs - captureStartMs) }))
    .filter((event) => event.atMs <= durationMs + 1000)
    .sort((left, right) => left.atMs - right.atMs);
}

export function hasTimedCpuSamples(cpuProfile: RawCpuProfile): boolean {
  return Boolean(
    cpuProfile.samples?.length &&
      cpuProfile.timeDeltas?.length &&
      cpuProfile.samples.length === cpuProfile.timeDeltas.length,
  );
}
