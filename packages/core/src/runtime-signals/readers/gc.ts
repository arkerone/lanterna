import type { CdpClient } from '../../inspector/client.js';
import type { RawGcEvent } from '../../capture/core/types.js';
import { rawGcEventSchema } from '../schemas.js';

const READ_GC_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_GC__) return [];
  return globalThis.__LANTERNA_GC__.read?.() ?? [];
})()`;

export async function readGcEvents(cdp: CdpClient): Promise<RawGcEvent[]> {
  try {
    const value = await cdp.evaluate(READ_GC_EXPRESSION);
    const parsed = rawGcEventSchema.array().safeParse(value);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
