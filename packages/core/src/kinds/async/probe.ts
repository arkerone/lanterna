import type { CdpClient } from '../../inspector/client.js';
import {
  disableAsyncOperations,
  drainAsyncOperations,
  readAsyncOperations,
} from '../../runtime-signals/readers/async-operations.js';
import type { CaptureProbe, ProbeLifecycleContext } from '../core/types.js';
import { normalizeCdpAsyncStackTrace } from './cdp-stack.js';
import type {
  AsyncCdpContext,
  AsyncConcurrencySample,
  AsyncKindData,
  AsyncOperationRecord,
} from './types.js';

export interface AsyncProbeOptions {
  /** Async stack depth requested via `Debugger.setAsyncCallStackDepth`. Capped at 64. */
  asyncStackDepth: number;
}

/**
 * Drives the async kind: enables `Debugger.setAsyncCallStackDepth` over CDP
 * (cheap, lets V8 attach async stacks to CPU samples + exceptions) and reads
 * the `async_hooks` aggregate published by the preload installer at stop.
 *
 * The CDP step alone gives a degraded but useful capture in attach mode,
 * where the preload hook isn't available — the analysis contributor flags
 * this with `collectedVia: 'cdp-only'`.
 */
// Profiler-side cap (drop-newest): CDP async-stack contexts arrive from
// exception/console/pause events at a rate the profiler doesn't control.
// Earliest contexts tend to carry the most useful startup attribution, so
// once the cap is hit, later ones are dropped rather than evicting history.
const CDP_ASYNC_CONTEXTS_CAP = 10_000;

export function createAsyncProbe(options: AsyncProbeOptions): CaptureProbe<AsyncKindData> {
  const cdpAsyncContexts: AsyncCdpContext[] = [];
  let cdpAsyncContextsDropped = 0;
  const unsubscribers: Array<() => void> = [];
  let asyncStackSupport: 'enabled' | 'unsupported' | 'unknown' = 'unknown';
  // Accumulated by periodic mid-capture drains (attach/in-process): each
  // drain removes only the async_hooks records that have already completed
  // by that point (see `installers/async-operations/source.ts`'s `drain`),
  // so a target that exits between drains still yields everything up to the
  // last one instead of only what the final `read()` sees.
  const drainedRecords: AsyncOperationRecord[] = [];
  const drainedConcurrency: AsyncConcurrencySample[] = [];
  return {
    stopTimeoutMs: 15_000,
    async drain(ctx: ProbeLifecycleContext) {
      if (ctx.cdp.closed) return;
      const drained = await drainAsyncOperations(ctx.cdp);
      if (!drained) return;
      drainedRecords.push(...drained.records);
      drainedConcurrency.push(...drained.concurrency);
    },
    async start(ctx: ProbeLifecycleContext) {
      const { cdp } = ctx;
      // Best-effort. Older Node builds may reject either call; the report still
      // makes sense without async stacks.
      try {
        await cdp.send('Debugger.enable');
        if (options.asyncStackDepth > 0) {
          await cdp.send('Debugger.setAsyncCallStackDepth', {
            maxDepth: options.asyncStackDepth,
          });
          asyncStackSupport = 'enabled';
        }
      } catch {
        asyncStackSupport = 'unsupported';
      }
      installCdpStackListeners(cdp, cdpAsyncContexts, unsubscribers, () => {
        cdpAsyncContextsDropped += 1;
      });
    },
    async stop(ctx: ProbeLifecycleContext): Promise<AsyncKindData> {
      const { cdp } = ctx;
      const read = cdp.closed ? null : await readAsyncOperations(cdp);
      const attachPartialCapture = isPartialHookInstallMode(ctx.mode);
      if (!read?.available) {
        // Even when the final read failed (e.g. the target exited before
        // stop could reach it), records/concurrency accumulated by earlier
        // periodic drains are still real data — surface them instead of
        // returning an empty section.
        const hasDrainedData = drainedRecords.length > 0 || drainedConcurrency.length > 0;
        return {
          available: hasDrainedData,
          collectedVia: hasDrainedData ? 'async-hooks' : read ? 'unavailable' : 'cdp-only',
          maxRecords: read?.maxRecords ?? 0,
          records: drainedRecords,
          concurrency: drainedConcurrency,
          integrity: {
            recordsDropped: 0,
            initCount: 0,
            destroyCount: 0,
            resolveCount: 0,
            orphanCount: 0,
          },
          filteredCounts: {},
          instrumentationMode: read?.instrumentationMode ?? 'safe',
          attachPartialCapture,
          clockResolutionMs: read?.clockResolutionMs,
          cdpAsyncStackSupport: asyncStackSupport,
          cdpAsyncStackDepthRequested: options.asyncStackDepth,
          cdpAsyncContexts,
          ...(cdpAsyncContextsDropped > 0 ? { cdpAsyncContextsDropped } : {}),
        };
      }
      return {
        available: true,
        collectedVia: 'async-hooks',
        maxRecords: read.maxRecords,
        records: [...drainedRecords, ...read.records],
        concurrency: [...drainedConcurrency, ...read.concurrency],
        integrity: read.integrity,
        filteredCounts: read.filteredCounts,
        instrumentationMode: read.instrumentationMode ?? 'safe',
        attachPartialCapture: attachPartialCapture || Boolean(read.attachPartialCapture),
        clockResolutionMs: read.clockResolutionMs,
        cdpAsyncStackSupport: asyncStackSupport,
        cdpAsyncStackDepthRequested: options.asyncStackDepth,
        transformStats: read.transformStats,
        cdpAsyncContexts,
        ...(cdpAsyncContextsDropped > 0 ? { cdpAsyncContextsDropped } : {}),
      };
    },
    async dispose(ctx: ProbeLifecycleContext) {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      if (ctx.cdp.closed) return;
      await disableAsyncOperations(ctx.cdp);
      try {
        await ctx.cdp.send('Debugger.disable');
      } catch {
        // best-effort cleanup
      }
    },
  };
}

function isPartialHookInstallMode(mode: ProbeLifecycleContext['mode']): boolean {
  return mode === 'attach' || mode === 'in-process';
}

function installCdpStackListeners(
  cdp: CdpClient,
  contexts: AsyncCdpContext[],
  unsubscribers: Array<() => void>,
  onDropped: () => void,
): void {
  const push = (context: AsyncCdpContext | undefined) => {
    if (!context) return;
    if (contexts.length >= CDP_ASYNC_CONTEXTS_CAP) {
      onDropped();
      return;
    }
    contexts.push(context);
  };
  unsubscribers.push(
    cdp.on('Runtime.exceptionThrown', (event) => {
      const stackTrace = (event as { exceptionDetails?: { stackTrace?: unknown } }).exceptionDetails
        ?.stackTrace;
      push(normalizeCdpAsyncStackTrace('Runtime.exceptionThrown', stackTrace));
    }),
  );
  unsubscribers.push(
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const stackTrace = (event as { stackTrace?: unknown }).stackTrace;
      push(normalizeCdpAsyncStackTrace('Runtime.consoleAPICalled', stackTrace));
    }),
  );
  unsubscribers.push(
    cdp.on('Debugger.paused', (event) => {
      const paused = event as {
        reason?: string;
        callFrames?: unknown[];
        asyncStackTrace?: unknown;
      };
      if (paused.reason !== 'exception' && paused.reason !== 'instrumentation') return;
      push(
        normalizeCdpAsyncStackTrace('Debugger.paused', {
          callFrames: paused.callFrames?.map((frame) => {
            const callFrame = frame as { functionName?: string; url?: string; location?: unknown };
            const location = callFrame.location as
              | { lineNumber?: number; columnNumber?: number }
              | undefined;
            return {
              functionName: callFrame.functionName,
              url: callFrame.url,
              lineNumber: location?.lineNumber,
              columnNumber: location?.columnNumber,
            };
          }),
          parent: paused.asyncStackTrace,
        }),
      );
    }),
  );
}
