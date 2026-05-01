import { asyncProfileReportSchema } from '../../report/schema/async-profile.js';
import { createAsyncOperationsInstaller } from '../../runtime-signals/hooks/installers/async-operations.js';
import type { CaptureProbe, ProfileKind } from '../core/types.js';
import { defineProfileKind } from '../core/types.js';
import { createAsyncAnalysisContributor } from './analysis.js';
import { createAsyncProbe } from './probe.js';
import type { AsyncKindData } from './types.js';

declare module '../core/types.js' {
  interface CaptureKindDataMap {
    async: AsyncKindData;
  }
}

export const DEFAULT_ASYNC_MAX_RECORDS = 50_000;
export const DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS = 100;
export const DEFAULT_ASYNC_STACK_DEPTH = 32;
export const MAX_ASYNC_STACK_DEPTH = 64;

export interface AsyncKindOptions {
  /** Cap on retained per-resource records. Defaults to 50 000. */
  maxRecords?: number;
  /** Cadence at which the inflight/active series is sampled. Defaults to 100ms. */
  concurrencyIntervalMs?: number;
  /** Include TickObject / Microtask resources (very noisy). Default false. */
  includeMicrotasks?: boolean;
  /** Async call-stack depth requested via CDP. Defaults to 32, max 64. */
  asyncStackDepth?: number;
  /** Extra async instrumentation. Defaults to safe. */
  instrumentationMode?: 'off' | 'safe' | 'full';
  /** True for attach mode, where pre-existing async resources cannot be observed. */
  attachPartialCapture?: boolean;
}

/**
 * The async profile kind. Drives `Debugger.setAsyncCallStackDepth` over CDP
 * and an `async_hooks` aggregator in the preload — produces the
 * `profiles.async.*` section (summary, top operations, chains, orphans,
 * concurrency timeline).
 *
 * Opt-in only — pass `--kind async` (combinable with `cpu` and `memory`).
 * Overhead is non-trivial; never enable implicitly.
 */
export function createAsyncProfileKind(options: AsyncKindOptions = {}): ProfileKind<AsyncKindData> {
  const maxRecords = validateMaxRecords(options.maxRecords ?? DEFAULT_ASYNC_MAX_RECORDS);
  const concurrencyIntervalMs = validateConcurrencyInterval(
    options.concurrencyIntervalMs ?? DEFAULT_ASYNC_CONCURRENCY_INTERVAL_MS,
  );
  const includeMicrotasks = Boolean(options.includeMicrotasks);
  const asyncStackDepth = validateAsyncStackDepth(
    options.asyncStackDepth ?? DEFAULT_ASYNC_STACK_DEPTH,
  );
  const instrumentationMode = options.instrumentationMode ?? 'safe';

  return defineProfileKind<AsyncKindData>({
    id: 'async',
    label: 'Async',
    reportSectionKey: 'async',
    reportSchema: asyncProfileReportSchema,
    hookInstaller: createAsyncOperationsInstaller({
      maxRecords,
      concurrencyIntervalMs,
      includeMicrotasks,
      stackDepth: asyncStackDepth,
      instrumentationMode,
      attachPartialCapture: Boolean(options.attachPartialCapture),
    }),
    createProbe: (): CaptureProbe<AsyncKindData> => createAsyncProbe({ asyncStackDepth }),
    createAnalysisContributor: () => createAsyncAnalysisContributor(),
    contributeMeta: (data) => ({
      collectedVia: data.collectedVia,
      maxRecords: data.maxRecords,
      concurrencyIntervalMs,
      asyncStackDepth,
      includeMicrotasks,
      instrumentationMode,
      transformStats: data.transformStats,
      operationCount: data.records.length,
    }),
    contributeIntegrity: (data) => ({
      available: data.available,
      collectedVia: data.collectedVia,
      recordsDropped: data.integrity.recordsDropped,
      orphanCount: data.integrity.orphanCount,
      initCount: data.integrity.initCount,
      destroyCount: data.integrity.destroyCount,
      resolveCount: data.integrity.resolveCount,
      instrumentationMode: data.instrumentationMode ?? instrumentationMode,
      attachPartialCapture: Boolean(data.attachPartialCapture),
      cdpAsyncStackCount: data.cdpAsyncContexts?.length ?? 0,
    }),
  });
}

function validateMaxRecords(value: number): number {
  if (!Number.isInteger(value) || value < 100) {
    throw new Error(`invalid async max records: ${value} (expected an integer >= 100)`);
  }
  return value;
}

function validateConcurrencyInterval(value: number): number {
  if (!Number.isFinite(value) || value < 10) {
    throw new Error(`invalid async concurrency interval: ${value} (expected >= 10ms)`);
  }
  return value;
}

function validateAsyncStackDepth(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_ASYNC_STACK_DEPTH) {
    throw new Error(
      `invalid async stack depth: ${value} (expected an integer in [0, ${MAX_ASYNC_STACK_DEPTH}])`,
    );
  }
  return value;
}

export type { AsyncAnalysisView } from './analysis.js';
export { createAsyncAnalysisContributor } from './analysis.js';
export type { AsyncProbeOptions } from './probe.js';
export { createAsyncProbe } from './probe.js';
export type {
  AsyncCdpAsyncStackSegment,
  AsyncCdpContext,
  AsyncChainNode,
  AsyncConcurrencySample,
  AsyncInstrumentationMode,
  AsyncIntegrityCounters,
  AsyncKindData,
  AsyncOperationKind,
  AsyncOperationRecord,
  AsyncRunWindow,
  AsyncStackFrame,
} from './types.js';
