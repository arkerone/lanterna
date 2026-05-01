import { z } from 'zod';
import type { CdpClient } from '../../inspector/client.js';
import type { AsyncInstrumentationMode, AsyncOperationKind } from '../../kinds/async/types.js';

const KIND_VALUES: AsyncOperationKind[] = [
  'promise',
  'timer',
  'immediate',
  'tcp',
  'udp',
  'fs',
  'http',
  'http2',
  'tls',
  'dns',
  'pipe',
  'process',
  'tickobject',
  'microtask',
  'other',
];

const stackFrameSchema = z.object({
  function: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
});

const runWindowSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
});

const recordSchema = z.object({
  asyncId: z.number().int(),
  triggerAsyncId: z.number().int(),
  kind: z.enum(KIND_VALUES as [AsyncOperationKind, ...AsyncOperationKind[]]),
  rawType: z.string(),
  initAtMs: z.number(),
  resolvedAtMs: z.number().optional(),
  destroyedAtMs: z.number().optional(),
  durationMs: z.number().optional(),
  runMs: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  orphan: z.boolean(),
  initStack: z.array(stackFrameSchema).default([]),
  runWindows: z.array(runWindowSchema).default([]),
  promiseRegistrationStack: z.array(stackFrameSchema).optional(),
  promiseHandlerStack: z.array(stackFrameSchema).optional(),
  awaitStack: z.array(stackFrameSchema).optional(),
  safeRegistrationStack: z.array(stackFrameSchema).optional(),
  safeHandlerStack: z.array(stackFrameSchema).optional(),
});

const concurrencySchema = z.object({
  atMs: z.number(),
  active: z.number().int().nonnegative(),
  inflight: z.number().int().nonnegative(),
});

const integritySchema = z.object({
  recordsDropped: z.number().int().nonnegative(),
  initCount: z.number().int().nonnegative(),
  destroyCount: z.number().int().nonnegative(),
  resolveCount: z.number().int().nonnegative(),
  orphanCount: z.number().int().nonnegative(),
});

const readSchema = z.object({
  available: z.boolean(),
  maxRecords: z.number().int().nonnegative(),
  records: z.array(recordSchema),
  concurrency: z.array(concurrencySchema),
  integrity: integritySchema,
  filteredCounts: z.record(z.string(), z.number().int().nonnegative()),
  instrumentationMode: z.enum(['off', 'safe', 'full']).optional(),
  attachPartialCapture: z.boolean().optional(),
  clockSyncUncertaintyMs: z.number().nonnegative().optional(),
  transformStats: z
    .object({
      transformed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      partial: z.boolean(),
      awaitCalls: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type AsyncOperationsRead = z.infer<typeof readSchema> & {
  instrumentationMode?: AsyncInstrumentationMode;
};

const READ_EXPRESSION = `(() => {
  if (!globalThis.__LANTERNA_ASYNC__) return null;
  return globalThis.__LANTERNA_ASYNC__.read?.() ?? null;
})()`;

export async function readAsyncOperations(cdp: CdpClient): Promise<AsyncOperationsRead | null> {
  try {
    const value = await cdp.evaluate(READ_EXPRESSION);
    const parsed = readSchema.safeParse(value);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
