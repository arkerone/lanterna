import { z } from 'zod';

export const rawGcEventSchema = z.object({
  atMs: z.number().finite(),
  kind: z.string(),
  durationMs: z.number().finite(),
});

export const eventLoopSampleSchema = z.object({
  atMs: z.number().finite(),
  lagMs: z.number().finite(),
});

const eventLoopSummarySchema = z.object({
  max: z.number().finite(),
  mean: z.number().finite(),
  p50: z.number().finite(),
  p99: z.number().finite(),
  count: z.number().int().nonnegative(),
});

export const eventLoopReadSchema = z.object({
  samples: z.array(eventLoopSampleSchema).optional(),
  summary: eventLoopSummarySchema.nullish(),
  resolutionMs: z.number().finite().optional(),
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
  eventLoopResolutionMs: z.number().finite().optional(),
  capabilities: z.object({
    eventLoop: z.boolean().optional(),
    gc: z.boolean().optional(),
    lifecycle: z.boolean().optional(),
  }).optional(),
});

export const controlCaptureStartSchema = z.object({
  type: z.literal('capture-start'),
  atMs: z.number().finite().optional(),
  resolutionMs: z.number().finite().optional(),
});

export const controlHeartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  atMs: z.number().finite(),
  lagMs: z.number().finite(),
});

export const controlGcSchema = z.object({
  type: z.literal('gc'),
  atMs: z.number().finite(),
  kind: z.string().optional(),
  durationMs: z.number().finite(),
});

export const controlAppCompleteSchema = z.object({
  type: z.literal('app-complete'),
  atMs: z.number().finite().optional(),
});

export const controlEventSchema = z.discriminatedUnion('type', [
  controlHookReadySchema,
  controlCaptureStartSchema,
  controlHeartbeatSchema,
  controlGcSchema,
  controlAppCompleteSchema,
]);

export type ParsedEventLoopRead = z.infer<typeof eventLoopReadSchema>;
export type ParsedTargetInfo = z.infer<typeof targetInfoSchema>;
export type ControlEvent = z.infer<typeof controlEventSchema>;
export type RawGcEventData = z.infer<typeof rawGcEventSchema>;
export type EventLoopSampleData = z.infer<typeof eventLoopSampleSchema>;
export type ParsedEventLoopSummary = z.infer<typeof eventLoopSummarySchema>;
