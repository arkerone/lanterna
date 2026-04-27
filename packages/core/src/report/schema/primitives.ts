import { z } from 'zod';

export const findingSeveritySchema = z.enum(['info', 'warning', 'critical']);
export const profileConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const findingConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const findingReportProofLevelSchema = z.enum([
  'direct-sample',
  'correlated-window',
  'trace-only',
  'heuristic',
]);
export const measurementBasisSchema = z.enum(['none', 'heartbeats', 'histogram', 'both']);
export const measurementConfidenceSchema = z.enum(['none', 'low', 'high']);
export const frameCategorySchema = z.enum([
  'user',
  'node_modules',
  'node:builtin',
  'native',
  'gc',
  'program',
  'idle',
  'lanterna',
  'unknown',
]);
export const optimizationStateSchema = z.enum(['optimized', 'interpreted', 'unknown']);

export const hotspotAttributionSchema = z.object({
  hotspotId: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  samplePct: z.number(),
  supportPct: z.number(),
  confidence: z.enum(['low', 'high']),
});

export const stallCorrelationSchema = z.object({
  overlapPct: z.number(),
  samplePct: z.number(),
});

export const attributionEvidenceSchema = z.object({
  proofLevel: z.enum(['direct-builtin', 'attributed-caller']),
  attributionBasis: z.enum(['sample-path', 'builtin-only']),
  attributionConfidence: z.enum(['low', 'high']),
  userAttribution: hotspotAttributionSchema.optional(),
});

export const alternativeHotspotEvidenceSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  selfPct: z.number(),
  totalPct: z.number(),
});

export const correlatedHotspotSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  overlapPct: z.number(),
  samplePct: z.number(),
  rank: z.number().int().positive(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const correlationCoverageSchema = z.object({
  samplesInWindows: z.number().int().nonnegative(),
  samplesAttributed: z.number().int().nonnegative(),
  windowCount: z.number().int().nonnegative(),
  attributionRate: z.number(),
});

export const gcCountSchema = z.object({
  scavenge: z.number().int().nonnegative(),
  markSweep: z.number().int().nonnegative(),
  incremental: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
});

export const eventLoopHistogramSchema = z.object({
  maxLagMs: z.number(),
  p99LagMs: z.number(),
  p50LagMs: z.number(),
  meanLagMs: z.number(),
});

export const stallIntervalSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  maxLagMs: z.number(),
});
