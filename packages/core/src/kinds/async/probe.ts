import type { CdpClient } from '../../inspector/client.js';
import {
  disableAsyncOperations,
  readAsyncOperations,
} from '../../runtime-signals/readers/async-operations.js';
import type { CaptureProbe } from '../core/types.js';
import { normalizeCdpAsyncStackTrace } from './cdp-stack.js';
import type { AsyncCdpContext, AsyncKindData } from './types.js';

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
export function createAsyncProbe(options: AsyncProbeOptions): CaptureProbe<AsyncKindData> {
  const cdpAsyncContexts: AsyncCdpContext[] = [];
  const unsubscribers: Array<() => void> = [];
  let asyncStackSupport: 'enabled' | 'unsupported' | 'unknown' = 'unknown';
  return {
    async start(cdp: CdpClient) {
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
      installCdpStackListeners(cdp, cdpAsyncContexts, unsubscribers);
    },
    async stop(cdp: CdpClient): Promise<AsyncKindData> {
      const read = cdp.closed ? null : await readAsyncOperations(cdp);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      // Tear down the in-target async_hooks installer (frees the sampler
      // timer, removes hooks, restores patched APIs). Critical in attach
      // mode where the target keeps running after capture ends.
      if (!cdp.closed) {
        await disableAsyncOperations(cdp);
        try {
          await cdp.send('Debugger.disable');
        } catch {
          // ignore
        }
      }
      if (!read?.available) {
        return {
          available: false,
          collectedVia: read ? 'unavailable' : 'cdp-only',
          maxRecords: read?.maxRecords ?? 0,
          records: [],
          concurrency: [],
          integrity: {
            recordsDropped: 0,
            initCount: 0,
            destroyCount: 0,
            resolveCount: 0,
            orphanCount: 0,
          },
          filteredCounts: {},
          instrumentationMode: read?.instrumentationMode ?? 'safe',
          attachPartialCapture: true,
          clockSyncUncertaintyMs: read?.clockSyncUncertaintyMs ?? 0,
          cdpAsyncStackSupport: asyncStackSupport,
          cdpAsyncStackDepthRequested: options.asyncStackDepth,
          cdpAsyncContexts,
        };
      }
      return {
        available: true,
        collectedVia: 'async-hooks',
        maxRecords: read.maxRecords,
        records: read.records,
        concurrency: read.concurrency,
        integrity: read.integrity,
        filteredCounts: read.filteredCounts,
        instrumentationMode: read.instrumentationMode ?? 'safe',
        attachPartialCapture: Boolean(read.attachPartialCapture),
        clockSyncUncertaintyMs: read.clockSyncUncertaintyMs ?? 0,
        cdpAsyncStackSupport: asyncStackSupport,
        cdpAsyncStackDepthRequested: options.asyncStackDepth,
        transformStats: read.transformStats,
        cdpAsyncContexts,
      };
    },
  };
}

function installCdpStackListeners(
  cdp: CdpClient,
  contexts: AsyncCdpContext[],
  unsubscribers: Array<() => void>,
): void {
  const push = (context: AsyncCdpContext | undefined) => {
    if (!context) return;
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
