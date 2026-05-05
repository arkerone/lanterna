import { z } from 'zod';
import { sourceLocationSchema } from './primitives.js';

const asyncOperationKindSchema = z.enum([
  'promise',
  'timer',
  'immediate',
  'tcp',
  'udp',
  'fs',
  'http',
  'http2',
  'tls',
  'dns',
  'pipe',
  'process',
  'tickobject',
  'microtask',
  'other',
]);

const asyncSummarySchema = z.object({
  available: z.boolean(),
  collectedVia: z.enum(['async-hooks', 'cdp-only', 'unavailable']),
  totalOperations: z.number().int().nonnegative(),
  byKind: z.partialRecord(asyncOperationKindSchema, z.number().int().nonnegative()),
  durationStats: z
    .object({
      p50Ms: z.number().nonnegative(),
      p95Ms: z.number().nonnegative(),
      p99Ms: z.number().nonnegative(),
      maxMs: z.number().nonnegative(),
      meanMs: z.number().nonnegative(),
    })
    .optional(),
  concurrency: z
    .object({
      meanInflight: z.number().nonnegative(),
      maxInflight: z.number().int().nonnegative(),
      meanActive: z.number().nonnegative(),
      maxActive: z.number().int().nonnegative(),
    })
    .optional(),
  orphanCount: z.number().int().nonnegative(),
  recordsDropped: z.number().int().nonnegative(),
  topAsyncHotFile: z
    .object({
      function: z.string(),
      file: z.string(),
      line: z.number().int().nonnegative(),
      score: z.number().nonnegative(),
      confidence: z.enum(['low', 'medium', 'high']),
      source: sourceLocationSchema.optional(),
    })
    .optional(),
});

const asyncStackFrameSchema = z.object({
  function: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  source: sourceLocationSchema.optional(),
});

const asyncCdpContextSchema = z.object({
  source: z.enum([
    'Runtime.exceptionThrown',
    'Runtime.consoleAPICalled',
    'Debugger.paused',
    'Runtime.evaluate',
  ]),
  proofLevel: z.literal('cdp-debugger-async-stack'),
  capturedAtMs: z.number().optional(),
  frames: z.array(asyncStackFrameSchema),
  asyncStack: z.array(
    z.object({
      description: z.string().optional(),
      frames: z.array(asyncStackFrameSchema),
    }),
  ),
});

const asyncTopOperationSchema = z.object({
  asyncId: z.number().int(),
  kind: asyncOperationKindSchema,
  rawType: z.string(),
  durationMs: z.number().nonnegative(),
  runMs: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
  initAtMs: z.number(),
  triggerAsyncId: z.number().int(),
  orphan: z.boolean(),
  initFrame: asyncStackFrameSchema.optional(),
  primaryFrame: asyncStackFrameSchema.optional(),
  primaryReason: z
    .enum(['creation', 'execution', 'await', 'promise-handler', 'cdp-async-context'])
    .optional(),
  creationFrame: asyncStackFrameSchema.optional(),
  executionFrame: asyncStackFrameSchema.optional(),
  awaitFrame: asyncStackFrameSchema.optional(),
  promiseRegistrationFrame: asyncStackFrameSchema.optional(),
  promiseHandlerFrame: asyncStackFrameSchema.optional(),
  cdpAsyncContextFrame: asyncStackFrameSchema.optional(),
  cdpAsyncStack: asyncCdpContextSchema.optional(),
  creationConfidence: z.enum(['low', 'medium', 'high']).optional(),
  executionConfidence: z.enum(['low', 'medium', 'high']).optional(),
  awaitConfidence: z.enum(['low', 'medium', 'high']).optional(),
  cdpAsyncContextConfidence: z.enum(['low', 'medium', 'high']).optional(),
  cpuAttributedSamples: z.number().int().nonnegative().optional(),
  cpuAmbiguousSamples: z.number().int().nonnegative().optional(),
  clockSyncUncertaintyMs: z.number().nonnegative().optional(),
  overallConfidence: z.enum(['low', 'medium', 'high']).optional(),
  initStack: z.array(asyncStackFrameSchema),
});

const asyncChainSchema = z.object({
  rootAsyncId: z.number().int(),
  rootKind: asyncOperationKindSchema,
  depth: z.number().int().nonnegative(),
  totalOperations: z.number().int().nonnegative(),
  totalDurationMs: z.number().nonnegative(),
  /** Path of types from root to deepest leaf (for human-readable inspection). */
  deepestPath: z.array(asyncOperationKindSchema),
  rootFrame: asyncStackFrameSchema.optional(),
  deepestFrame: asyncStackFrameSchema.optional(),
  dominantFile: z.string().optional(),
});

const asyncOrphanSchema = z.object({
  asyncId: z.number().int(),
  kind: asyncOperationKindSchema,
  rawType: z.string(),
  initAtMs: z.number(),
  ageMs: z.number().nonnegative(),
  triggerAsyncId: z.number().int(),
  initFrame: asyncStackFrameSchema.optional(),
  initStack: z.array(asyncStackFrameSchema),
});

const asyncCpuAttributionEntrySchema = z.object({
  rootAsyncId: z.number().int(),
  rootKind: asyncOperationKindSchema,
  rootFrame: asyncStackFrameSchema.optional(),
  executionFrame: asyncStackFrameSchema.optional(),
  executionConfidence: z.enum(['low', 'medium', 'high']).optional(),
  cpuPct: z.number().nonnegative(),
  cpuMs: z.number().nonnegative(),
  contributingOperations: z.number().int().nonnegative(),
});

const asyncCpuAttributionSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  attributedCpuPct: z.number().nonnegative(),
  totalCpuMs: z.number().nonnegative(),
  cpuAttributedSamples: z.number().int().nonnegative(),
  cpuAmbiguousSamples: z.number().int().nonnegative(),
  clockSyncUncertaintyMs: z.number().nonnegative(),
  topChains: z.array(asyncCpuAttributionEntrySchema),
});

const asyncQualitySchema = z.object({
  confidence: z.enum(['low', 'medium', 'high']),
  instrumentationMode: z.enum(['off', 'safe', 'full']),
  attachPartialCapture: z.boolean(),
  operationCount: z.number().int().nonnegative(),
  sampledStackRatio: z.number().min(0).max(1),
  initStackCoverageRatio: z.number().min(0).max(1),
  cdpAsyncStackCoverageRatio: z.number().min(0).max(1),
  recordsDropped: z.number().int().nonnegative(),
  maxRecords: z.number().int().nonnegative(),
  runWindowCount: z.number().int().nonnegative(),
  cpuAttributionCoveragePct: z.number().nonnegative(),
  cpuAmbiguousSamples: z.number().int().nonnegative(),
  clockSyncUncertaintyMs: z.number().nonnegative(),
  reasons: z.array(z.string()),
  recommendations: z.array(z.string()),
});

const asyncHotFileSchema = z.object({
  file: z.string(),
  score: z.number().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  primaryFrame: asyncStackFrameSchema,
  operationCount: z.number().int().nonnegative(),
  totalDurationMs: z.number().nonnegative(),
  orphanCount: z.number().int().nonnegative(),
  maxOrphanAgeMs: z.number().nonnegative(),
  maxChainDepth: z.number().int().nonnegative(),
  cpuPct: z.number().nonnegative(),
  runMs: z.number().nonnegative(),
  kindBreakdown: z.partialRecord(asyncOperationKindSchema, z.number().int().nonnegative()),
  sampleAsyncIds: z.array(z.number().int()),
});

const asyncConcurrencySampleSchema = z.object({
  atMs: z.number(),
  active: z.number().int().nonnegative(),
  inflight: z.number().int().nonnegative(),
});

export const asyncProfileReportSchema = z.object({
  summary: asyncSummarySchema,
  quality: asyncQualitySchema,
  hotFiles: z.array(asyncHotFileSchema),
  topOperations: z.array(asyncTopOperationSchema),
  chains: z.array(asyncChainSchema),
  orphans: z.array(asyncOrphanSchema),
  concurrencyTimeline: z.array(asyncConcurrencySampleSchema),
  filteredCounts: z.record(z.string(), z.number().int().nonnegative()),
  cdpAsyncContexts: z.array(asyncCdpContextSchema),
  cpuAttribution: asyncCpuAttributionSchema,
});

export type AsyncProfileReportSchema = z.infer<typeof asyncProfileReportSchema>;
