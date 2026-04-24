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
  stallCorrelationSchema,
  stallIntervalSchema,
} from './primitives.js';

const cpuSummarySchema = z.object({
  totalCpuMs: z.number().finite(),
  onCpuRatio: z.number().finite(),
  userCodeRatio: z.number().finite(),
  nodeModulesRatio: z.number().finite(),
  builtinRatio: z.number().finite(),
  nativeRatio: z.number().finite(),
  gcRatio: z.number().finite(),
  idleRatio: z.number().finite(),
  topCategory: frameCategorySchema,
  dominantBlockingKind: z.union([z.literal('sync-crypto'), z.literal('blocking-io'), z.null()]),
  topUserHotspot: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int(),
      selfPct: z.number().finite(),
      totalPct: z.number().finite(),
      eventLoopCorrelation: stallCorrelationSchema.optional(),
      alternativeHotspots: z.array(alternativeHotspotEvidenceSchema).optional(),
    })
    .optional(),
});

const hotspotRefSchema = z.object({
  id: z.string().min(1),
  pct: z.number().finite(),
});

const hotspotSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  category: frameCategorySchema,
  package: z.string().optional(),
  selfMs: z.number().finite(),
  selfPct: z.number().finite(),
  totalMs: z.number().finite(),
  totalPct: z.number().finite(),
  callers: z.array(hotspotRefSchema),
  callees: z.array(hotspotRefSchema),
  optimizationState: optimizationStateSchema,
});

const hotStackFrameSchema = z.object({
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  category: frameCategorySchema,
});

const hotStackSchema = z.object({
  weightPct: z.number().finite(),
  frames: z.array(hotStackFrameSchema),
});

const hotStackClusterSchema = z.object({
  anchor: z.object({
    function: z.string(),
    file: z.string(),
    line: z.number().int(),
  }),
  weightPct: z.number().finite(),
  stackCount: z.number().int().positive(),
  memberIndices: z.array(z.number().int().nonnegative()),
});

const gcReportSchema = z.object({
  totalPauseMs: z.number().finite(),
  count: gcCountSchema,
  longestPauseMs: z.number().finite(),
  pausesOver10ms: z.array(
    z.object({
      atMs: z.number().finite(),
      kind: z.string(),
      durationMs: z.number().finite(),
    }),
  ),
  correlatedHotspots: z.array(correlatedHotspotSchema).optional(),
  correlationCoverage: correlationCoverageSchema.optional(),
});

const eventLoopReportSchema = z.object({
  maxLagMs: z.number().finite(),
  p99LagMs: z.number().finite(),
  p50LagMs: z.number().finite(),
  meanLagMs: z.number().finite(),
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
});

export const cpuProfileReportSchema = z.object({
  summary: cpuSummarySchema,
  hotspots: z.array(hotspotSchema),
  hotStacks: z.array(hotStackSchema),
  hotStackClusters: z.array(hotStackClusterSchema).optional(),
  gc: gcReportSchema,
  eventLoop: eventLoopReportSchema,
  deopts: z.array(deoptEntrySchema),
});
