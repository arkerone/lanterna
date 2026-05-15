import { z } from 'zod';
import {
  alternativeHotspotEvidenceSchema,
  correlatedHotspotSchema,
  correlationCoverageSchema,
  eventLoopHistogramSchema,
  frameCategorySchema,
  gcCountSchema,
  measurementBasisSchema,
  measurementConfidenceSchema,
  optimizationStateSchema,
  profileConfidenceSchema,
  sourceLocationSchema,
  stallCorrelationSchema,
  stallIntervalSchema,
  userCallerAttributionSchema,
} from './primitives.js';

const cpuSummarySchema = z.object({
  totalCpuMs: z.number(),
  onCpuRatio: z.number(),
  userCodeRatio: z.number(),
  nodeModulesRatio: z.number(),
  builtinRatio: z.number(),
  nativeRatio: z.number(),
  gcRatio: z.number(),
  idleRatio: z.number(),
  topCategory: frameCategorySchema,
  dominantBlockingKind: z.union([z.literal('sync-crypto'), z.literal('blocking-io'), z.null()]),
  topCpuCulprit: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int(),
      selfPct: z.number(),
      totalPct: z.number(),
      eventLoopCorrelation: stallCorrelationSchema.optional(),
      alternativeHotspots: z.array(alternativeHotspotEvidenceSchema).optional(),
      source: sourceLocationSchema.optional(),
    })
    .optional(),
  topRequestEntry: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int(),
      selfPct: z.number(),
      totalPct: z.number(),
      eventLoopCorrelation: stallCorrelationSchema.optional(),
      alternativeHotspots: z.array(alternativeHotspotEvidenceSchema).optional(),
      source: sourceLocationSchema.optional(),
    })
    .optional(),
  topUserHotspot: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int(),
      selfPct: z.number(),
      totalPct: z.number(),
      eventLoopCorrelation: stallCorrelationSchema.optional(),
      alternativeHotspots: z.array(alternativeHotspotEvidenceSchema).optional(),
      source: sourceLocationSchema.optional(),
    })
    .optional(),
});

const hotspotRefSchema = z.object({
  id: z.string().min(1),
  pct: z.number(),
});

const hotspotSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  category: frameCategorySchema,
  package: z.string().optional(),
  selfMs: z.number(),
  selfPct: z.number(),
  totalMs: z.number(),
  totalPct: z.number(),
  callers: z.array(hotspotRefSchema),
  callees: z.array(hotspotRefSchema),
  optimizationState: optimizationStateSchema,
  source: sourceLocationSchema.optional(),
  userCaller: userCallerAttributionSchema.optional(),
});

const hotStackFrameSchema = z.object({
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  category: frameCategorySchema,
  source: sourceLocationSchema.optional(),
});

const hotStackSchema = z.object({
  weightPct: z.number(),
  frames: z.array(hotStackFrameSchema),
});

const hotStackClusterSchema = z.object({
  anchor: z.object({
    function: z.string(),
    file: z.string(),
    line: z.number().int(),
    source: sourceLocationSchema.optional(),
  }),
  weightPct: z.number(),
  stackCount: z.number().int().positive(),
  memberIndices: z.array(z.number().int().nonnegative()),
});

const gcReportSchema = z.object({
  totalPauseMs: z.number(),
  count: gcCountSchema,
  longestPauseMs: z.number(),
  pausesOver10ms: z.array(
    z.object({
      atMs: z.number(),
      kind: z.string(),
      durationMs: z.number(),
    }),
  ),
  correlatedHotspots: z.array(correlatedHotspotSchema).optional(),
  correlationCoverage: correlationCoverageSchema.optional(),
});

const eventLoopReportSchema = z.object({
  maxLagMs: z.number(),
  p99LagMs: z.number(),
  p50LagMs: z.number(),
  meanLagMs: z.number(),
  sampleCount: z.number().int().nonnegative(),
  stallIntervals: z.array(stallIntervalSchema),
  available: z.boolean(),
  measurementBasis: measurementBasisSchema,
  confidence: measurementConfidenceSchema,
  histogram: eventLoopHistogramSchema.optional(),
  correlatedHotspots: z.array(correlatedHotspotSchema).optional(),
  correlationCoverage: correlationCoverageSchema.optional(),
});

const deoptEntrySchema = z.object({
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
  bailoutType: z.string(),
  count: z.number().int().nonnegative(),
  explanation: z.string(),
  source: sourceLocationSchema.optional(),
});

const profileQualitySchema = z.object({
  confidence: profileConfidenceSchema,
  sampleCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  idleRatio: z.number(),
  samplesTimed: z.boolean(),
  durationBasis: z.enum(['timeDeltas', 'sampleInterval']),
  reasons: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export const cpuProfileReportSchema = z.object({
  summary: cpuSummarySchema,
  hotspots: z.array(hotspotSchema),
  hotStacks: z.array(hotStackSchema),
  hotStackClusters: z.array(hotStackClusterSchema).optional(),
  gc: gcReportSchema,
  eventLoop: eventLoopReportSchema,
  quality: profileQualitySchema,
  deopts: z.array(deoptEntrySchema),
});
