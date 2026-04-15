import type { CdpClient } from './cdp-client.js';
import type {
  EventLoopHistogram,
  EventLoopSample,
  RawCpuProfile,
  TargetInfo,
} from './source.js';
import type { EventLoopReadResult } from './measures/event-loop.js';

export async function markCaptureStart(cdp: CdpClient): Promise<void> {
  await cdp.send('Runtime.evaluate', {
    expression: `globalThis.__LANTERNA_EVENT_LOOP__?.markCaptureStart?.()`,
    returnByValue: true,
  });
}

export async function readRuntimeClockNow(cdp: CdpClient): Promise<number> {
  const res = await cdp.send<{ result: { value?: number } }>('Runtime.evaluate', {
    expression: 'performance.now()',
    returnByValue: true,
  });
  return res.result?.value ?? 0;
}

export async function fetchTargetInfo(cdp: CdpClient): Promise<TargetInfo> {
  await cdp.send('Runtime.enable');
  const expr = `JSON.stringify({
    pid: process.pid,
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd()
  })`;
  const res = await cdp.send<{ result: { value?: string } }>('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
  });
  const value = res.result?.value ?? '{}';
  return JSON.parse(value) as TargetInfo;
}

export function summarizeEventLoop(samples: EventLoopSample[]): EventLoopHistogram | undefined {
  if (samples.length === 0) return undefined;
  const values = samples.map((sample) => sample.lagMs).sort((a, b) => a - b);
  const maxMs = values[values.length - 1] ?? 0;
  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    maxMs,
    meanMs,
    p50Ms: percentile(values, 0.5),
    p99Ms: percentile(values, 0.99),
  };
}

export function mergeTimedSamples(
  primary: EventLoopSample[],
  secondary: EventLoopSample[],
): EventLoopSample[] {
  const merged = new Map<string, EventLoopSample>();
  for (const sample of [...primary, ...secondary]) {
    const key = `${sample.atMs.toFixed(3)}:${sample.lagMs.toFixed(3)}`;
    merged.set(key, sample);
  }
  return Array.from(merged.values());
}

export function isUsableEventLoopSummary(
  summary: EventLoopReadResult['summary'],
  resolutionMs: number,
): summary is NonNullable<EventLoopReadResult['summary']> {
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

export function normalizeTimedEvents<T extends { atMs: number }>(
  events: T[],
  startMs: number,
  durationMs: number,
): T[] {
  return events
    .map((event) => ({ ...event, atMs: Math.max(0, event.atMs - startMs) }))
    .filter((event) => event.atMs <= durationMs + 1000)
    .sort((a, b) => a.atMs - b.atMs);
}

export function hasTimedCpuSamples(cpuProfile: RawCpuProfile): boolean {
  return Boolean(
    cpuProfile.samples?.length
    && cpuProfile.timeDeltas?.length
    && cpuProfile.samples.length === cpuProfile.timeDeltas.length,
  );
}

function percentile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * q) - 1));
  return sortedValues[index] ?? 0;
}
