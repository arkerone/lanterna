import type { EventLoopSample } from '../../capture/core/types.js';
import type { CdpClient } from '../../inspector/client.js';
import { eventLoopReadSchema, eventLoopSampleSchema } from '../schemas.js';

export interface EventLoopReadResult {
  samples: EventLoopSample[];
  available: boolean;
  resolutionMs?: number;
  summary?: {
    maxMs: number;
    meanMs: number;
    p50Ms: number;
    p99Ms: number;
    count: number;
  };
}

const READ_EVENT_LOOP_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_EVENT_LOOP__) return null;
  return globalThis.__LANTERNA_EVENT_LOOP__.read();
})()`;

export async function readEventLoopSamples(cdp: CdpClient): Promise<EventLoopReadResult> {
  try {
    const value = await cdp.evaluate(READ_EVENT_LOOP_EXPRESSION);
    const parsed = eventLoopReadSchema.safeParse(value);
    if (!parsed.success) return { samples: [], available: false };

    return {
      samples: parsed.data.samples ?? [],
      available: true,
      resolutionMs: parsed.data.resolutionMs,
      summary: parsed.data.summary
        ? {
            maxMs: parsed.data.summary.max,
            meanMs: parsed.data.summary.mean,
            p50Ms: parsed.data.summary.p50,
            p99Ms: parsed.data.summary.p99,
            count: parsed.data.summary.count,
          }
        : undefined,
    };
  } catch {
    return { samples: [], available: false };
  }
}

const DRAIN_EVENT_LOOP_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_EVENT_LOOP__?.drain) return null;
  return globalThis.__LANTERNA_EVENT_LOOP__.drain();
})()`;

/**
 * Periodic mid-capture drain (attach/in-process): pulls and empties the
 * in-target heartbeat buffer without disturbing the histogram, so a target
 * that exits or blocks between drains still yields everything observed up to
 * the last one. Returns `[]` if the hook is unavailable or the read fails —
 * callers treat that the same as "nothing new since the last drain".
 */
export async function drainEventLoopSamples(cdp: CdpClient): Promise<EventLoopSample[]> {
  try {
    const value = await cdp.evaluate(DRAIN_EVENT_LOOP_EXPRESSION);
    const parsed = eventLoopSampleSchema.array().safeParse(value);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
