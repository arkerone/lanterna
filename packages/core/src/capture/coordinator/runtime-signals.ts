import type { EventLoopReadResult } from '../../runtime-signals/readers/event-loop.js';
import { isUsableEventLoopSummary, summarizeEventLoop } from '../core/timed-signals.js';
import type { EventLoopHistogram, EventLoopSample, RawGcEvent } from '../core/types.js';

export function resolveEventLoopHistogram(
  eventLoopRead: EventLoopReadResult,
  normalizedEventLoopSamples: EventLoopSample[],
  resolutionMs: number | undefined,
): EventLoopHistogram | undefined {
  if (isUsableEventLoopSummary(eventLoopRead.summary, resolutionMs ?? 20)) {
    return eventLoopRead.summary;
  }
  return summarizeEventLoop(normalizedEventLoopSamples);
}

export function dedupeTimedEvents(events: RawGcEvent[]): RawGcEvent[] {
  const byKey = new Map<string, RawGcEvent>();
  for (const event of events) {
    const key = `${event.atMs.toFixed(3)}|${event.kind}|${event.durationMs.toFixed(3)}`;
    byKey.set(key, event);
  }
  return [...byKey.values()];
}
