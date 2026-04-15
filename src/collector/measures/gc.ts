import type { CdpClient } from '../cdp-client.js';
import type { RawGcEvent } from '../source.js';

export interface GcCollector {
  stop(): Promise<RawGcEvent[]>;
}

export async function startGcMeasure(cdp: CdpClient): Promise<GcCollector> {
  // GC data is collected by the preload hook (event-loop-hook.cjs) via PerformanceObserver.
  // We read it via Runtime.evaluate at stop time.
  return {
    async stop(): Promise<RawGcEvent[]> {
      try {
        const expr = `(() => {
          if (!globalThis.__LANTERNA_GC__) return null;
          const events = globalThis.__LANTERNA_GC__.read();
          globalThis.__LANTERNA_GC__.clear();
          return events;
        })()`;
        const res = await cdp.send<{ result: { value?: unknown } }>('Runtime.evaluate', {
          expression: expr,
          returnByValue: true,
        });
        const events = res.result?.value as Array<{ atMs?: number; kind: string; durationMs: number }> | null;
        if (!events) return [];
        return events.map((e) => ({
          atMs: e.atMs ?? 0,
          kind: e.kind,
          durationMs: e.durationMs,
        }));
      } catch {
        return [];
      }
    },
  };
}
