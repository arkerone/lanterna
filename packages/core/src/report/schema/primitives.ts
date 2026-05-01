import { z } from 'zod';

export const FINDING_SEVERITIES = ['info', 'warning', 'critical'] as const;
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export const FINDING_REPORT_PROOF_LEVELS = [
  'direct-sample',
  'correlated-window',
  'trace-only',
  'heuristic',
] as const;
export const MEASUREMENT_BASES = ['none', 'heartbeats', 'histogram', 'both'] as const;
export const MEASUREMENT_CONFIDENCES = ['none', 'low', 'high'] as const;
export const FRAME_CATEGORIES = [
  'user',
  'node_modules',
  'node:builtin',
  'native',
  'gc',
  'program',
  'idle',
  'lanterna',
  'unknown',
] as const;
export const OPTIMIZATION_STATES = ['optimized', 'interpreted', 'unknown'] as const;

export const findingSeveritySchema = z.enum(FINDING_SEVERITIES);
export const profileConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const findingConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const findingReportProofLevelSchema = z.enum(FINDING_REPORT_PROOF_LEVELS);
export const measurementBasisSchema = z.enum(MEASUREMENT_BASES);
export const measurementConfidenceSchema = z.enum(MEASUREMENT_CONFIDENCES);
export const frameCategorySchema = z.enum(FRAME_CATEGORIES);
export const optimizationStateSchema = z.enum(OPTIMIZATION_STATES);

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
