import { z } from 'zod';
import { frameCategorySchema } from './primitives.js';

const memoryHotAllocatorSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  category: frameCategorySchema,
  package: z.string().optional(),
  selfBytes: z.number().finite().nonnegative(),
  selfPct: z.number().finite(),
  totalBytes: z.number().finite().nonnegative(),
  totalPct: z.number().finite(),
});

const memoryUsageSampleSchema = z.object({
  atMs: z.number().finite(),
  rss: z.number().finite().nonnegative(),
  heapTotal: z.number().finite().nonnegative(),
  heapUsed: z.number().finite().nonnegative(),
  external: z.number().finite().nonnegative(),
  arrayBuffers: z.number().finite().nonnegative(),
});

const seriesStatsSchema = z.object({
  startBytes: z.number().finite().nonnegative(),
  endBytes: z.number().finite().nonnegative(),
  minBytes: z.number().finite().nonnegative(),
  maxBytes: z.number().finite().nonnegative(),
  meanBytes: z.number().finite().nonnegative(),
  p95Bytes: z.number().finite().nonnegative(),
  /** Linear regression slope, bytes per second. */
  slopeBytesPerSec: z.number().finite(),
});

const memorySummarySchema = z.object({
  totalSampledBytes: z.number().finite().nonnegative(),
  samplingIntervalBytes: z.number().finite().positive(),
  rss: seriesStatsSchema.optional(),
  heapUsed: seriesStatsSchema.optional(),
  external: seriesStatsSchema.optional(),
  arrayBuffers: seriesStatsSchema.optional(),
  topAllocator: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int(),
      selfPct: z.number().finite(),
      totalPct: z.number().finite(),
    })
    .optional(),
  externalRatio: z.number().finite().optional(),
});

export const memoryProfileReportSchema = z.object({
  summary: memorySummarySchema,
  hotAllocators: z.array(memoryHotAllocatorSchema),
  memoryUsage: z.object({
    samples: z.array(memoryUsageSampleSchema),
    available: z.boolean(),
    sampleIntervalMs: z.number().finite().positive(),
  }),
});
