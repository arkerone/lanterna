import { z } from 'zod';

const findingSeveritySchema = z.enum(['info', 'warning', 'critical']);
const measurementBasisSchema = z.enum(['none', 'heartbeats', 'histogram', 'both']);
const measurementConfidenceSchema = z.enum(['none', 'low', 'high']);
const frameCategorySchema = z.enum([
  'user',
  'node_modules',
  'node:builtin',
  'native',
  'gc',
  'program',
  'idle',
  'unknown',
]);
const optimizationStateSchema = z.enum(['optimized', 'interpreted', 'unknown']);

const hotspotAttributionSchema = z.object({
  hotspotId: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  samplePct: z.number().finite(),
  supportPct: z.number().finite(),
  confidence: z.enum(['low', 'high']),
});

const stallCorrelationSchema = z.object({
  overlapPct: z.number().finite(),
  samplePct: z.number().finite(),
});

const attributionEvidenceSchema = z.object({
  attributionBasis: z.enum(['sample-path', 'builtin-only']),
  attributionConfidence: z.enum(['low', 'high']),
  userAttribution: hotspotAttributionSchema.optional(),
});

const correlatedHotspotSchema = z.object({
  id: z.string().min(1),
  function: z.string(),
  file: z.string(),
  line: z.number().int(),
  overlapPct: z.number().finite(),
  samplePct: z.number().finite(),
});

const gcCountSchema = z.object({
  scavenge: z.number().int().nonnegative(),
  markSweep: z.number().int().nonnegative(),
  incremental: z.number().int().nonnegative(),
  other: z.number().int().nonnegative(),
});

const eventLoopHistogramSchema = z.object({
  maxLagMs: z.number().finite(),
  p99LagMs: z.number().finite(),
  p50LagMs: z.number().finite(),
  meanLagMs: z.number().finite(),
});

const stallIntervalSchema = z.object({
  startMs: z.number().finite(),
  endMs: z.number().finite(),
  maxLagMs: z.number().finite(),
});

const blockingIoExtraSchema = attributionEvidenceSchema.extend({
  api: z.string().min(1),
  callee: z.string().min(1),
  eventLoopCorrelation: stallCorrelationSchema.optional(),
});

const syncCryptoExtraSchema = attributionEvidenceSchema.extend({
  callee: z.string().min(1),
  calleeTotalPct: z.number().finite(),
  eventLoopCorrelation: stallCorrelationSchema.optional(),
});

const deoptLoopExtraSchema = z.object({
  reason: z.string().min(1),
  bailoutType: z.string().min(1),
  count: z.number().int().nonnegative(),
});

const excessiveGcExtraSchema = z.object({
  gcRatio: z.number().finite(),
  longestPauseMs: z.number().finite(),
  timedGcEventCount: z.number().int().nonnegative(),
  ratioConfidence: z.enum(['high', 'medium']),
  counts: gcCountSchema,
  candidateHotspots: z.array(correlatedHotspotSchema),
});

const eventLoopStallExtraSchema = z.object({
  p99LagMs: z.number().finite(),
  maxLagMs: z.number().finite(),
  measurementBasis: measurementBasisSchema,
  confidence: measurementConfidenceSchema,
  histogram: eventLoopHistogramSchema.optional(),
  stallIntervals: z.array(stallIntervalSchema),
  candidateHotspots: z.array(correlatedHotspotSchema),
});

const builtinFindingExtraSchema = z.union([
  blockingIoExtraSchema,
  syncCryptoExtraSchema,
  deoptLoopExtraSchema,
  excessiveGcExtraSchema,
  eventLoopStallExtraSchema,
]);

const genericFindingExtraSchema = z.record(z.string(), z.unknown());

const findingEvidenceSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  function: z.string(),
  selfPct: z.number().finite(),
  extra: z.union([builtinFindingExtraSchema, genericFindingExtraSchema]).optional(),
});

const findingSchema = z.object({
  id: z.string().min(1),
  severity: findingSeveritySchema,
  category: z.string().min(1),
  title: z.string().min(1),
  evidence: findingEvidenceSchema,
  why: z.string().min(1),
  suggestion: z.string().min(1),
  references: z.array(z.string()),
}).superRefine((finding, ctx) => {
  const { category } = finding;
  const { extra } = finding.evidence;

  const schemaByCategory = {
    'blocking-io': blockingIoExtraSchema,
    'sync-crypto': syncCryptoExtraSchema,
    'deopt-loop': deoptLoopExtraSchema,
    'excessive-gc': excessiveGcExtraSchema,
    'event-loop-stall': eventLoopStallExtraSchema,
  } as const;

  if (category === 'require-in-hot-path') {
    if (extra !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'extra'],
        message: 'require-in-hot-path findings must not include evidence.extra',
      });
    }
    return;
  }

  const extraSchema = schemaByCategory[category as keyof typeof schemaByCategory];
  if (!extraSchema) {
    if (extra !== undefined && (typeof extra !== 'object' || extra === null || Array.isArray(extra))) {
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

const metaSchema = z.object({
  nodeVersion: z.string().min(1),
  v8Version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
  durationMs: z.number().finite(),
  sampleIntervalMicros: z.number().finite(),
  totalSamples: z.number().int().nonnegative(),
  cwd: z.string().min(1),
  command: z.array(z.string()),
  lanternaVersion: z.string().min(1),
  mode: z.enum(['spawn', 'attach', 'in-process']),
  deep: z.boolean(),
  captureIntegrity: z.object({
    controlChannel: z.boolean(),
    eventLoopTimed: z.boolean(),
    gcTimed: z.boolean(),
    cpuSamplesTimed: z.boolean(),
  }),
});

const summarySchema = z.object({
  totalCpuMs: z.number().finite(),
  onCpuRatio: z.number().finite(),
  userCodeRatio: z.number().finite(),
  nodeModulesRatio: z.number().finite(),
  builtinRatio: z.number().finite(),
  nativeRatio: z.number().finite(),
  gcRatio: z.number().finite(),
  idleRatio: z.number().finite(),
  topCategory: frameCategorySchema,
  dominantBlockingKind: z.union([
    z.literal('sync-crypto'),
    z.literal('blocking-io'),
    z.null(),
  ]),
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

const gcReportSchema = z.object({
  totalPauseMs: z.number().finite(),
  count: gcCountSchema,
  longestPauseMs: z.number().finite(),
  pausesOver10ms: z.array(z.object({
    atMs: z.number().finite(),
    kind: z.string(),
    durationMs: z.number().finite(),
  })),
  correlatedHotspots: z.array(correlatedHotspotSchema).optional(),
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

export const lanternaReportSchema = z.object({
  meta: metaSchema,
  summary: summarySchema,
  hotspots: z.array(hotspotSchema),
  hotStacks: z.array(hotStackSchema),
  gc: gcReportSchema,
  eventLoop: eventLoopReportSchema,
  deopts: z.array(deoptEntrySchema),
  findings: z.array(findingSchema),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
