import type { CaptureBundle } from '../../capture/core/types.js';
import type { AsyncCpuAttribution, AsyncProfileReport } from '../../report/types.js';
import type { KindAnalysisContext, KindAnalysisContributor } from '../core/types.js';
import { buildChains, buildOrphans } from './analysis/chains.js';
import {
  type AsyncFrameReporter,
  collectAsyncFrameUrls,
  createAsyncFrameReporter,
} from './analysis/frames.js';
import { buildHotFiles } from './analysis/hot-files.js';
import { analyzeAsyncOperations } from './analysis/operation-analysis.js';
import { buildQuality } from './analysis/quality.js';
import { buildSummary } from './analysis/summary.js';
import { correlateCdpAsyncContexts } from './analysis/top-operations.js';
import type { AsyncChainNode, AsyncKindData, AsyncOperationRecord } from './types.js';

export interface AsyncAnalysisView {
  data: AsyncKindData;
  bundle: CaptureBundle;
  /** Async trigger tree, keyed by asyncId. */
  chainNodes: Map<number, AsyncChainNode>;
  /** Sorted records by total duration desc. */
  sortedByDuration: AsyncOperationRecord[];
  /** Map asyncId → root asyncId in its trigger tree. */
  rootByAsyncId: Map<number, number>;
  /** CPU attribution per chain root, when CPU kind was captured. */
  cpuAttribution: AsyncCpuAttribution;
}

declare module '../core/types.js' {
  interface KindViews {
    async: AsyncAnalysisView;
  }
}

export function createAsyncAnalysisContributor(): KindAnalysisContributor<AsyncKindData> {
  return {
    analyze(ctx: KindAnalysisContext<AsyncKindData>) {
      const { data, bundle } = ctx;
      const frameReporter = createAsyncFrameReporter(ctx.options.sourceMaps);
      if (ctx.options.sourceMaps) {
        ctx.options.sourceMaps.prepare(collectAsyncFrameUrls(data));
      }
      analyzeInner(ctx, data, bundle, frameReporter);
    },
  };
}

function analyzeInner(
  ctx: KindAnalysisContext<AsyncKindData>,
  data: AsyncKindData,
  bundle: CaptureBundle,
  frameReporter: AsyncFrameReporter,
): void {
  correlateCdpAsyncContexts(data.records, data.cdpAsyncContexts ?? [], frameReporter);
  const operations = analyzeAsyncOperations({ data, bundle, frameReporter });

  const chains = buildChains(operations.chainNodes, operations.recordById, frameReporter);
  const orphans = buildOrphans(data.records, bundle.durationMs, frameReporter);
  const quality = buildQuality({
    data,
    cpuAttribution: operations.cpuAttribution,
    recordById: operations.recordById,
    clockSyncUncertaintyMs: operations.clockSyncUncertaintyMs,
    eventLoopSignalAvailable: operations.signals.eventLoop,
  });
  const hotFiles = buildHotFiles({
    records: data.records,
    captureDurationMs: bundle.durationMs,
    chainNodes: operations.chainNodes,
    rootByAsyncId: operations.rootByAsyncId,
    cpuAttribution: operations.cpuAttribution,
    quality,
    frameReporter,
  });
  const summary = buildSummary(data, bundle.durationMs, hotFiles);

  const report: AsyncProfileReport = {
    summary,
    quality,
    hotFiles,
    topOperations: operations.topOperations,
    chains,
    orphans,
    concurrencyTimeline: data.concurrency,
    filteredCounts: data.filteredCounts,
    cdpAsyncContexts: (data.cdpAsyncContexts ?? []).map(frameReporter.toReportCdpContext),
    cpuAttribution: operations.cpuAttribution,
  };

  ctx.writeSection<AsyncProfileReport>(report);
  ctx.setContextView<AsyncAnalysisView>({
    data,
    bundle,
    chainNodes: operations.chainNodes,
    sortedByDuration: operations.sortedByDuration,
    rootByAsyncId: operations.rootByAsyncId,
    cpuAttribution: operations.cpuAttribution,
  });
}
