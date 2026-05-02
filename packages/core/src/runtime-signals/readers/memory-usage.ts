import { z } from 'zod';
import type { CdpClient } from '../../inspector/client.js';
import type { MemoryUsageSample } from '../../report/types.js';

const memoryUsageSampleSchema = z.object({
  atMs: z.number(),
  rss: z.number().nonnegative(),
  heapTotal: z.number().nonnegative(),
  heapUsed: z.number().nonnegative(),
  external: z.number().nonnegative(),
  arrayBuffers: z.number().nonnegative(),
});

const memoryUsageReadSchema = z.object({
  samples: z.array(memoryUsageSampleSchema),
  sampleIntervalMs: z.number().positive(),
});

export interface MemoryUsageReadResult {
  samples: MemoryUsageSample[];
  available: boolean;
  sampleIntervalMs: number;
}

const READ_MEMORY_USAGE_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_MEMORY__) return null;
  return globalThis.__LANTERNA_MEMORY__.read?.() ?? null;
})()`;

const DISABLE_MEMORY_USAGE_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_MEMORY__) return null;
  globalThis.__LANTERNA_MEMORY__.disable?.();
  return true;
})()`;

export async function readMemoryUsageSeries(cdp: CdpClient): Promise<MemoryUsageReadResult> {
  try {
    const value = await cdp.evaluate(READ_MEMORY_USAGE_EXPRESSION);
    const parsed = memoryUsageReadSchema.safeParse(value);
    if (!parsed.success) return { samples: [], available: false, sampleIntervalMs: 0 };
    return {
      samples: parsed.data.samples,
      available: true,
      sampleIntervalMs: parsed.data.sampleIntervalMs,
    };
  } catch {
    return { samples: [], available: false, sampleIntervalMs: 0 };
  }
}

export async function disableMemoryUsageSeries(cdp: CdpClient): Promise<void> {
  try {
    await cdp.evaluate(DISABLE_MEMORY_USAGE_EXPRESSION);
  } catch {
    // best-effort
  }
}
