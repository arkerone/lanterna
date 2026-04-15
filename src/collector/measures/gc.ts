import type { CdpClient } from '../cdp-client.js';
import type { RawGcEvent } from '../source.js';

export async function readGcEvents(cdp: CdpClient): Promise<RawGcEvent[]> {
  const expr = `(() => {
    if (!globalThis.__LANTERNA_GC__) return [];
    return globalThis.__LANTERNA_GC__.read?.() ?? [];
  })()`;

  try {
    const res = await cdp.send<{ result: { value?: RawGcEvent[] } }>('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
    });
    return Array.isArray(res.result?.value) ? res.result.value : [];
  } catch {
    return [];
  }
}
