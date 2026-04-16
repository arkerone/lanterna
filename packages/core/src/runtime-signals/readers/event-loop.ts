import type { EventLoopSample } from '../../capture/core/types.js';
import type { CdpClient } from '../../inspector/client.js';
import { eventLoopReadSchema } from '../schemas.js';

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
