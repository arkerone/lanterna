import { z } from 'zod';
import {
  alternativeHotspotEvidenceSchema,
  attributionEvidenceSchema,
  correlatedHotspotSchema,
  eventLoopHistogramSchema,
  findingConfidenceSchema,
  findingReportProofLevelSchema,
  findingSeveritySchema,
  gcCountSchema,
  measurementBasisSchema,
  measurementConfidenceSchema,
  stallCorrelationSchema,
  stallIntervalSchema,
} from './primitives.js';

export const blockingIoExtraSchema = attributionEvidenceSchema.extend({
  api: z.string().min(1),
  callee: z.string().min(1),
  eventLoopCorrelation: stallCorrelationSchema.optional(),
  categoryTotalPct: z.number().optional(),
});

export const syncCryptoExtraSchema = attributionEvidenceSchema.extend({
  callee: z.string().min(1),
  calleeTotalPct: z.number(),
  eventLoopCorrelation: stallCorrelationSchema.optional(),
  categoryTotalPct: z.number().optional(),
});

export const deoptLoopExtraSchema = z.object({
  proofLevel: z.literal('deopt-trace-only'),
  reason: z.string().min(1),
  bailoutType: z.string().min(1),
  count: z.number().int().nonnegative(),
  hotspotTotalPct: z.number().optional(),
});

export const requireInHotPathExtraSchema = attributionEvidenceSchema.extend({
  callee: z.string().min(1),
});

export const excessiveGcExtraSchema = z.object({
  proofLevel: z.literal('aggregate-correlation'),
  gcRatio: z.number(),
  longestPauseMs: z.number(),
  timedGcEventCount: z.number().int().nonnegative(),
  ratioConfidence: z.enum(['high', 'medium']),
  counts: gcCountSchema,
  candidateHotspots: z.array(correlatedHotspotSchema),
});

export const eventLoopStallExtraSchema = z.object({
  proofLevel: z.literal('aggregate-correlation'),
  p99LagMs: z.number(),
  maxLagMs: z.number(),
  measurementBasis: measurementBasisSchema,
  confidence: measurementConfidenceSchema,
  histogram: eventLoopHistogramSchema.optional(),
  stallIntervals: z.array(stallIntervalSchema),
  candidateHotspots: z.array(correlatedHotspotSchema),
});

export const jsonHotPathExtraSchema = attributionEvidenceSchema.extend({
  callee: z.string().min(1),
  calleeTotalPct: z.number(),
  eventLoopCorrelation: stallCorrelationSchema.optional(),
  categoryTotalPct: z.number().optional(),
});

export const nodeModulesHotspotExtraSchema = attributionEvidenceSchema.extend({
  package: z.string().min(1).optional(),
  callee: z.string().min(1),
  calleeFile: z.string().min(1).optional(),
  calleeLine: z.number().int().optional(),
  calleeTotalPct: z.number(),
  eventLoopCorrelation: stallCorrelationSchema.optional(),
  alternativeHotspots: z.array(alternativeHotspotEvidenceSchema).optional(),
});

const builtinFindingExtraSchema = z.union([
  blockingIoExtraSchema,
  syncCryptoExtraSchema,
  deoptLoopExtraSchema,
  requireInHotPathExtraSchema,
  excessiveGcExtraSchema,
  eventLoopStallExtraSchema,
  jsonHotPathExtraSchema,
  nodeModulesHotspotExtraSchema,
]);

const genericFindingExtraSchema = z.record(z.string(), z.unknown());

const findingEvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  function: z.string(),
  selfPct: z.number(),
  extra: z.union([builtinFindingExtraSchema, genericFindingExtraSchema]).optional(),
});

const findingMeasurementsSchema = z.object({
  observed: z.record(z.string(), z.number()),
  thresholds: z.record(z.string(), z.number()),
});

const findingPrioritySchema = z.object({
  score: z.number(),
  impactEstimateMs: z.number().optional(),
  actionConfidence: z.enum(['low', 'medium', 'high']),
});

const findingRemediationSchema = z.object({
  kind: z.enum([
    'async-variant',
    'lazy-import-hoist',
    'offload-worker',
    'replace-library',
    'cache',
    'other',
  ]),
  replace: z.string().min(1).optional(),
  with: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  docs: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

export const findingSchema = z
  .object({
    id: z.string().min(1),
    profileKind: z.string().min(1),
    severity: findingSeveritySchema,
    category: z.string().min(1),
    title: z.string().min(1),
    evidence: findingEvidenceSchema,
    measurements: findingMeasurementsSchema.optional(),
    priority: findingPrioritySchema.optional(),
    confidence: findingConfidenceSchema.optional(),
    proofLevel: findingReportProofLevelSchema.optional(),
    remediation: findingRemediationSchema.optional(),
    why: z.string().min(1),
    suggestion: z.string().min(1),
    references: z.array(z.string()),
  })
  .superRefine((finding, ctx) => {
    const { category } = finding;
    const { extra } = finding.evidence;

    const schemaByCategory = {
      'blocking-io': blockingIoExtraSchema,
      'sync-crypto': syncCryptoExtraSchema,
      'deopt-loop': deoptLoopExtraSchema,
      'require-in-hot-path': requireInHotPathExtraSchema,
      'excessive-gc': excessiveGcExtraSchema,
      'event-loop-stall': eventLoopStallExtraSchema,
      'json-on-hot-path': jsonHotPathExtraSchema,
      'node-modules-hotspot': nodeModulesHotspotExtraSchema,
    } as const;

    const extraSchema = schemaByCategory[category as keyof typeof schemaByCategory];
    if (!extraSchema) {
      if (
        extra !== undefined &&
        (typeof extra !== 'object' || extra === null || Array.isArray(extra))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'extra'],
          message: 'custom finding evidence.extra must be a plain object when present',
        });
      }
      return;
    }

    const parsed = extraSchema.safeParse(extra);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ['evidence', 'extra', ...issue.path],
        });
      }
    }
  });
