import { buildGcCorrelationWindows } from '../../../analysis/model/correlations.js';
import type { CaptureBundle, RawCpuProfile } from '../../../capture/core/types.js';
import type {
  AsyncCpuAttribution,
  AsyncTopOperation,
  UserCallerAttribution,
} from '../../../report/types.js';
import type { AsyncChainNode, AsyncKindData, AsyncOperationRecord } from '../types.js';
import { buildChainTree, buildRootMap } from './chains.js';
import { buildCpuAttribution } from './cpu-attribution.js';
import type { AsyncFrameReporter } from './frames.js';
import {
  buildAsyncSignalWindows,
  buildTopOperations,
  effectiveDuration,
} from './top-operations.js';

export interface AnalyzeAsyncOperationsArgs {
  data: AsyncKindData;
  bundle: CaptureBundle;
  frameReporter: AsyncFrameReporter;
}

export interface AsyncOperationAnalysis {
  sortedByDuration: AsyncOperationRecord[];
  recordById: Map<number, AsyncOperationRecord>;
  chainNodes: Map<number, AsyncChainNode>;
  rootByAsyncId: Map<number, number>;
  cpuAttribution: AsyncCpuAttribution;
  topOperations: AsyncTopOperation[];
  signals: { eventLoop: boolean; gc: boolean };
  clockSyncUncertaintyMs: number;
}

export function analyzeAsyncOperations(args: AnalyzeAsyncOperationsArgs): AsyncOperationAnalysis {
  const { data, bundle, frameReporter } = args;
  const sortedByDuration = [...data.records].sort(
    (a, b) => effectiveDuration(b, bundle.durationMs) - effectiveDuration(a, bundle.durationMs),
  );
  const recordById = new Map<number, AsyncOperationRecord>();
  for (const rec of data.records) recordById.set(rec.asyncId, rec);

  const chainNodes = buildChainTree(data.records, recordById);
  const rootByAsyncId = buildRootMap(data.records, recordById);
  const clockSyncUncertaintyMs = Math.max(
    bundle.cdpClockJitterMs ?? 0,
    data.clockResolutionMs ?? 0,
  );
  const signals = {
    eventLoop:
      Boolean(bundle.captureIntegrity.eventLoopTimed) &&
      bundle.runtimeSignals.eventLoopSamples.length > 0,
    gc: Boolean(bundle.captureIntegrity.gcTimed),
  };
  const cpuAttribution = buildCpuAttribution({
    records: data.records,
    recordById,
    rootByAsyncId,
    chainNodes,
    cpuKind: bundle.kinds.cpu as { cpuProfile: RawCpuProfile } | undefined,
    clockSyncUncertaintyMs,
    frameReporter,
  });

  return {
    sortedByDuration,
    recordById,
    chainNodes,
    rootByAsyncId,
    cpuAttribution,
    topOperations: buildTopOperations({
      sorted: sortedByDuration.filter((rec) => !rec.orphan),
      captureDurationMs: bundle.durationMs,
      rootByAsyncId,
      userCallerByRootId: userCallersByRootId(cpuAttribution),
      recordById,
      chainNodes,
      stallWindows: buildAsyncSignalWindows({
        eventLoopSamples: bundle.runtimeSignals.eventLoopSamples,
        durationMs: bundle.durationMs,
        eventLoopResolutionMs: bundle.runtimeSignals.eventLoopResolutionMs,
      }),
      gcWindows: buildGcCorrelationWindows(bundle.runtimeSignals.gcEvents, bundle.durationMs, 0),
      signals,
      clockSyncUncertaintyMs,
      frameReporter,
    }),
    signals,
    clockSyncUncertaintyMs,
  };
}

function userCallersByRootId(
  cpuAttribution: AsyncCpuAttribution,
): Map<number, UserCallerAttribution> {
  const callers = new Map<number, UserCallerAttribution>();
  for (const entry of cpuAttribution.topChains) {
    if (entry.userCaller) callers.set(entry.rootAsyncId, entry.userCaller);
  }
  return callers;
}
