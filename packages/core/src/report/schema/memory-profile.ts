import { z } from 'zod';
import {
  frameCategorySchema,
  sourceLocationSchema,
  userCallerAttributionSchema,
} from './primitives.js';

const memoryHotAllocatorSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  category: frameCategorySchema,
  package: z.string().optional(),
  selfBytes: z.number().nonnegative(),
  selfPct: z.number(),
  totalBytes: z.number().nonnegative(),
  totalPct: z.number(),
  source: sourceLocationSchema.optional(),
  userCaller: userCallerAttributionSchema.optional(),
});

const memoryUsageSampleSchema = z.object({
  atMs: z.number(),
  rss: z.number().nonnegative(),
  heapTotal: z.number().nonnegative(),
  heapUsed: z.number().nonnegative(),
  external: z.number().nonnegative(),
  arrayBuffers: z.number().nonnegative(),
});

const seriesStatsSchema = z.object({
  startBytes: z.number().nonnegative(),
  endBytes: z.number().nonnegative(),
  minBytes: z.number().nonnegative(),
  maxBytes: z.number().nonnegative(),
  meanBytes: z.number().nonnegative(),
  p95Bytes: z.number().nonnegative(),
  /** Linear regression slope, bytes per second. */
  slopeBytesPerSec: z.number(),
});

const memorySummarySchema = z.object({
  totalSampledBytes: z.number().nonnegative(),
  samplingIntervalBytes: z.number().positive(),
  rss: seriesStatsSchema.optional(),
  heapUsed: seriesStatsSchema.optional(),
  external: seriesStatsSchema.optional(),
  arrayBuffers: seriesStatsSchema.optional(),
  topAllocator: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int(),
      selfPct: z.number(),
      totalPct: z.number(),
      source: sourceLocationSchema.optional(),
      userCaller: userCallerAttributionSchema.optional(),
    })
    .optional(),
  externalRatio: z.number().optional(),
});

const heapSnapshotAnalysisSchema = z.object({
  available: z.boolean(),
  mode: z.literal('start-end'),
  start: z.object({ path: z.string() }),
  end: z.object({ path: z.string() }),
  summary: z.object({
    totalRetainedGrowthBytes: z.number().nonnegative(),
    topGrowingConstructor: z.string().optional(),
  }),
  growthByConstructor: z.array(
    z.object({
      name: z.string(),
      countDelta: z.number().int(),
      selfSizeDeltaBytes: z.number(),
      retainedSizeDeltaBytes: z.number(),
    }),
  ),
  retainerPaths: z.array(
    z.object({
      constructorName: z.string(),
      retainedBytes: z.number().nonnegative(),
      path: z.array(z.string()),
      suspectedPattern: z.enum(['closure', 'event-listener', 'timer', 'cache', 'unknown']),
      confidence: z.enum(['low', 'medium', 'high']),
    }),
  ),
  warnings: z.array(z.string()),
});

export const memoryProfileReportSchema = z.object({
  summary: memorySummarySchema,
  hotAllocators: z.array(memoryHotAllocatorSchema),
  memoryUsage: z.object({
    available: z.boolean(),
    sampleIntervalMs: z.number().positive(),
    sampleCount: z.number().int().nonnegative(),
    firstSample: memoryUsageSampleSchema.optional(),
    lastSample: memoryUsageSampleSchema.optional(),
    samples: z.array(memoryUsageSampleSchema).optional(),
  }),
  heapSnapshotAnalysis: heapSnapshotAnalysisSchema.optional(),
});
