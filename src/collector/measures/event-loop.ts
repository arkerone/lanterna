import type { CdpClient } from '../cdp-client.js';
import type { EventLoopSample } from '../source.js';

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

export async function readEventLoopSamples(cdp: CdpClient): Promise<EventLoopReadResult> {
  const expr = `(() => {
    if (!globalThis.__LANTERNA_EVENT_LOOP__) return null;
    return globalThis.__LANTERNA_EVENT_LOOP__.read();
  })()`;

  try {
    const res = await cdp.send<{ result: { value?: unknown } }>('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
    });
    const value = res.result?.value as
      | {
        samples?: EventLoopSample[];
        summary?: { max: number; mean: number; p50: number; p99: number; count: number };
        resolutionMs?: number;
      }
      | null
      | undefined;
    if (!value) return { samples: [], available: false };
    return {
      samples: value.samples ?? [],
      available: true,
      resolutionMs: value.resolutionMs,
      summary: value.summary ? {
        maxMs: value.summary.max,
        meanMs: value.summary.mean,
        p50Ms: value.summary.p50,
        p99Ms: value.summary.p99,
        count: value.summary.count,
      } : undefined,
    };
  } catch {
    return { samples: [], available: false };
  }
}
