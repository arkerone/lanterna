import type { RawGcEvent } from '../../capture/core/types.js';
import type { GcReport } from '../../report/types.js';

export function buildGcReport(events: RawGcEvent[]): GcReport {
  let totalPauseMs = 0;
  let longestPauseMs = 0;
  const count = { scavenge: 0, markSweep: 0, incremental: 0, other: 0 };
  const pausesOver10ms: GcReport['pausesOver10ms'] = [];

  for (const event of events) {
    totalPauseMs += event.durationMs;
    if (event.durationMs > longestPauseMs) {
      longestPauseMs = event.durationMs;
    }

    const gcKind = event.kind as keyof typeof count;
    if (gcKind in count) {
      count[gcKind] += 1;
    } else {
      count.other += 1;
    }

    if (event.durationMs >= 10) {
      pausesOver10ms.push({
        atMs: event.atMs,
        kind: event.kind,
        durationMs: event.durationMs,
      });
    }
  }

  return {
    totalPauseMs,
    count,
    longestPauseMs,
    pausesOver10ms,
  };
}
