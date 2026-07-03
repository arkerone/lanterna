import type { RawGcEvent } from '../../capture/core/types.js';
import type { CdpClient } from '../../inspector/client.js';
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

const DRAIN_GC_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_GC__?.drain) return [];
  return globalThis.__LANTERNA_GC__.drain();
})()`;

/**
 * Periodic mid-capture drain (attach/in-process): pulls and empties the
 * in-target GC event buffer. See {@link readGcEvents} for the final,
 * non-draining read.
 */
export async function drainGcEvents(cdp: CdpClient): Promise<RawGcEvent[]> {
  try {
    const value = await cdp.evaluate(DRAIN_GC_EXPRESSION);
    const parsed = rawGcEventSchema.array().safeParse(value);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
