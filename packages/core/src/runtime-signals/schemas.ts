import { z } from 'zod';

export const rawGcEventSchema = z.object({
  atMs: z.number(),
  kind: z.string(),
  durationMs: z.number(),
});

export const eventLoopSampleSchema = z.object({
  atMs: z.number(),
  lagMs: z.number(),
});

export const memoryUsageSampleSchema = z.object({
  atMs: z.number(),
  rss: z.number().nonnegative(),
  heapTotal: z.number().nonnegative(),
  heapUsed: z.number().nonnegative(),
  external: z.number().nonnegative(),
  arrayBuffers: z.number().nonnegative(),
});

const eventLoopSummarySchema = z.object({
  max: z.number(),
  mean: z.number(),
  p50: z.number(),
  p99: z.number(),
  count: z.number().int().nonnegative(),
});

export const runtimeIntegrityCountersSchema = z.object({
  controlChannelWriteErrors: z.number().int().nonnegative(),
  gcObserverSetupFailed: z.number().int().nonnegative(),
  heartbeatDropped: z.number().int().nonnegative(),
});

export const eventLoopReadSchema = z.object({
  samples: z.array(eventLoopSampleSchema).optional(),
  summary: eventLoopSummarySchema.nullish(),
  resolutionMs: z.number().optional(),
});

export const targetInfoSchema = z.object({
  pid: z.number().int().positive().optional(),
  nodeVersion: z.string().min(1),
  v8Version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  cwd: z.string().min(1),
});

export const controlHookReadySchema = z.object({
  type: z.literal('hook-ready'),
  eventLoopResolutionMs: z.number().optional(),
  capabilities: z
    .object({
      eventLoop: z.boolean().optional(),
      gc: z.boolean().optional(),
      lifecycle: z.boolean().optional(),
    })
    .optional(),
  integrity: runtimeIntegrityCountersSchema.optional(),
});

export const controlCaptureStartSchema = z.object({
  type: z.literal('capture-start'),
  atMs: z.number().optional(),
  resolutionMs: z.number().optional(),
});

export const controlHeartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  atMs: z.number(),
  lagMs: z.number(),
});

export const controlGcSchema = z.object({
  type: z.literal('gc'),
  atMs: z.number(),
  kind: z.string().optional(),
  durationMs: z.number(),
});

export const controlMemoryUsageSchema = memoryUsageSampleSchema.extend({
  type: z.literal('memory-usage'),
  sampleIntervalMs: z.number().positive(),
  captureStarted: z.boolean().optional(),
});

export const controlAppCompleteSchema = z.object({
  type: z.literal('app-complete'),
  atMs: z.number().optional(),
  integrity: runtimeIntegrityCountersSchema.optional(),
});

export const controlEventSchema = z.discriminatedUnion('type', [
  controlHookReadySchema,
  controlCaptureStartSchema,
  controlHeartbeatSchema,
  controlGcSchema,
  controlMemoryUsageSchema,
  controlAppCompleteSchema,
]);

export type ParsedEventLoopRead = z.infer<typeof eventLoopReadSchema>;
export type ParsedTargetInfo = z.infer<typeof targetInfoSchema>;
export type ControlEvent = z.infer<typeof controlEventSchema>;
export type RawGcEventData = z.infer<typeof rawGcEventSchema>;
export type EventLoopSampleData = z.infer<typeof eventLoopSampleSchema>;
export type ParsedEventLoopSummary = z.infer<typeof eventLoopSummarySchema>;
