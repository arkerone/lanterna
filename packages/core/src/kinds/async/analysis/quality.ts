import type {
  AsyncCpuAttribution,
  AsyncProfileQuality,
  ProfileConfidence,
} from '../../../report/types.js';
import { resolveAttributedFrame } from '../latency.js';
import type { AsyncKindData, AsyncOperationRecord } from '../types.js';

export interface BuildQualityArgs {
  data: AsyncKindData;
  cpuAttribution: AsyncCpuAttribution;
  recordById: Map<number, AsyncOperationRecord>;
  clockSyncUncertaintyMs: number;
  eventLoopSignalAvailable: boolean;
}

export function buildQuality(args: BuildQualityArgs): AsyncProfileQuality {
  const { data, cpuAttribution, recordById, clockSyncUncertaintyMs, eventLoopSignalAvailable } =
    args;
  const operationCount = data.records.length;
  const recordsWithStacks = data.records.filter((rec) => rec.initStack.length > 0).length;
  const sampledStackRatio = operationCount > 0 ? recordsWithStacks / operationCount : 0;
  const attributedStackRatio =
    operationCount > 0
      ? data.records.filter((rec) => {
          const origin = resolveAttributedFrame(rec, recordById).origin;
          return origin === 'self' || origin === 'inherited-trigger';
        }).length / operationCount
      : 0;
  const cpuSamplesConsidered =
    cpuAttribution.cpuAttributedSamples + cpuAttribution.cpuAmbiguousSamples;
  const ambiguousRatio =
    cpuSamplesConsidered > 0 ? cpuAttribution.cpuAmbiguousSamples / cpuSamplesConsidered : 0;
  const cdpAsyncStackCoverageRatio =
    operationCount > 0 ? Math.min(1, (data.cdpAsyncContexts?.length ?? 0) / operationCount) : 0;
  const runWindowCount = data.records.reduce((sum, rec) => sum + rec.runWindows.length, 0);
  const reasons: string[] = [];
  const recommendations = new Set<string>();
  const attachPartialCapture = Boolean(data.attachPartialCapture);
  const instrumentationMode = data.instrumentationMode ?? 'safe';

  if (operationCount === 0) {
    reasons.push('no async operations were captured');
    recommendations.add('Capture during representative async activity.');
  }
  if (operationCount > 0 && sampledStackRatio < 1) {
    reasons.push(
      `only ${(sampledStackRatio * 100).toFixed(0)}% of async operations include init stacks`,
    );
    recommendations.add('Increase async stack depth for better file attribution.');
  }
  if (data.integrity.recordsDropped > 0) {
    reasons.push(
      `${data.integrity.recordsDropped} async records were dropped because maxRecords=${data.maxRecords} was reached`,
    );
    recommendations.add('Increase --async-max-events or shorten the capture window.');
  }
  if (data.collectedVia !== 'async-hooks') {
    reasons.push(`async_hooks data was not available; collection used ${data.collectedVia}`);
    recommendations.add('Use spawn mode or ensure the Lanterna preload can install async_hooks.');
  }
  if (attachPartialCapture) {
    reasons.push(
      'runtime hooks installed after startup can only observe async resources created after installation',
    );
    recommendations.add('Use run mode for complete startup async lifecycle coverage.');
  }
  if (operationCount > 0 && !eventLoopSignalAvailable) {
    reasons.push(
      'event-loop signal was unavailable, so latency causes cannot distinguish a blocked loop from genuine I/O wait (such operations are reported as `unknown` with basis `no-eventloop-signal`)',
    );
    recommendations.add(
      'Capture in spawn mode (or ensure the event-loop heartbeat is available) to classify event-loop-blocked latency.',
    );
  }
  if (cpuAttribution.cpuAmbiguousSamples > 0) {
    reasons.push(
      `${cpuAttribution.cpuAmbiguousSamples} CPU samples overlapped multiple async run windows and were marked ambiguous`,
    );
    recommendations.add(
      'Treat CPU-to-async attribution as directional when async windows overlap.',
    );
  }
  if (clockSyncUncertaintyMs > 10) {
    reasons.push(
      `runtime/CDP clock synchronization uncertainty was ${clockSyncUncertaintyMs.toFixed(1)}ms`,
    );
  }
  if (cpuAttribution.available && runWindowCount === 0) {
    reasons.push('no async run windows were available for CPU attribution');
    recommendations.add(
      'Capture a workload where async resources execute during the profiling window.',
    );
  }
  if (instrumentationMode === 'full' && data.transformStats?.partial) {
    reasons.push(
      `full async instrumentation transformed ${data.transformStats.transformed} files, skipped ${data.transformStats.skipped}, and failed ${data.transformStats.failed}`,
    );
    recommendations.add(
      'Treat await-frame coverage as partial; ESM entrypoints and unparseable files may need a dedicated loader.',
    );
  }
  if (data.integrity.pendingAwaitStacksDropped) {
    reasons.push(
      `${data.integrity.pendingAwaitStacksDropped} await call-site stacks were evicted before their promise could claim them`,
    );
    recommendations.add(
      'Treat await-stack attribution as sampled under very high await-call rates.',
    );
  }
  if (data.integrity.runWindowsDropped) {
    reasons.push(
      `${data.integrity.runWindowsDropped} run windows were evicted from very hot resources (CPU-attribution windows truncated)`,
    );
  }
  if (data.integrity.concurrencySamplesDropped) {
    reasons.push(
      `${data.integrity.concurrencySamplesDropped} concurrency samples were evicted from the in-target buffer (very long capture)`,
    );
  }
  if (data.cdpAsyncContextsDropped) {
    reasons.push(
      `${data.cdpAsyncContextsDropped} CDP async-stack contexts were dropped once the profiler-side cap was reached`,
    );
  }

  return {
    confidence: scoreAsyncConfidence({
      operationCount,
      sampledStackRatio,
      recordsDropped: data.integrity.recordsDropped,
      collectedVia: data.collectedVia,
      attachPartialCapture,
      cpuAmbiguousRatio: ambiguousRatio,
      fullTransformPartial: instrumentationMode === 'full' && Boolean(data.transformStats?.partial),
    }),
    instrumentationMode,
    attachPartialCapture,
    operationCount,
    sampledStackRatio,
    initStackCoverageRatio: sampledStackRatio,
    attributedStackRatio,
    cdpAsyncStackCoverageRatio,
    recordsDropped: data.integrity.recordsDropped,
    maxRecords: data.maxRecords,
    runWindowCount,
    cpuAttributionCoveragePct: cpuAttribution.attributedCpuPct,
    cpuAmbiguousSamples: cpuAttribution.cpuAmbiguousSamples,
    ambiguousRatio,
    clockSyncUncertaintyMs,
    ...(data.integrity.pendingAwaitStacksDropped
      ? { pendingAwaitStacksDropped: data.integrity.pendingAwaitStacksDropped }
      : {}),
    ...(data.integrity.runWindowsDropped
      ? { runWindowsDropped: data.integrity.runWindowsDropped }
      : {}),
    ...(data.integrity.concurrencySamplesDropped
      ? { concurrencySamplesDropped: data.integrity.concurrencySamplesDropped }
      : {}),
    ...(data.cdpAsyncContextsDropped
      ? { cdpAsyncContextsDropped: data.cdpAsyncContextsDropped }
      : {}),
    reasons,
    recommendations: Array.from(recommendations),
  };
}

function scoreAsyncConfidence(input: {
  operationCount: number;
  sampledStackRatio: number;
  recordsDropped: number;
  collectedVia: AsyncKindData['collectedVia'];
  attachPartialCapture: boolean;
  cpuAmbiguousRatio: number;
  fullTransformPartial: boolean;
}): ProfileConfidence {
  if (input.attachPartialCapture || input.cpuAmbiguousRatio > 0.5 || input.fullTransformPartial) {
    return 'low';
  }
  if (
    input.operationCount > 0 &&
    input.sampledStackRatio >= 0.99 &&
    input.recordsDropped === 0 &&
    input.collectedVia === 'async-hooks'
  ) {
    return 'high';
  }
  if (
    input.operationCount > 0 &&
    input.sampledStackRatio >= 0.5 &&
    input.recordsDropped === 0 &&
    input.collectedVia === 'async-hooks'
  ) {
    return 'medium';
  }
  return 'low';
}
