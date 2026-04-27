import {
  buildGcCorrelationWindows,
  buildTimedSamples,
  correlateUserHotspotsWithCoverage,
  type TimedSample,
} from '../../analysis/model/correlations.js';
import { enrichDeopts } from '../../analysis/model/deopts.js';
import { buildEventLoopReport } from '../../analysis/model/event-loop-report.js';
import { buildGcReport } from '../../analysis/model/gc-report.js';
import { clusterHotStacksByUserAnchor, computeHotStacks } from '../../analysis/model/hot-stacks.js';
import {
  buildHotspotAnalysis,
  type EnrichedTree,
  enrichCpuTree,
  type HotspotAnalysis,
} from '../../analysis/model/hotspots.js';
import { buildCpuProfileQuality } from '../../analysis/model/profile-quality.js';
import {
  buildCpuSummary,
  deriveDominantBlockingKind,
  deriveTopUserHotspot,
} from '../../analysis/model/summary.js';
import type { CaptureBundle } from '../../capture/core/types.js';
import type { CpuProfileReport, EventLoopReport, GcReport } from '../../report/types.js';
import type {
  KindAnalysisContext,
  KindAnalysisContributor,
  KindFinalizeHook,
  KindViews,
  ProfileSectionMap,
} from '../core/types.js';
import type { CpuKindData } from './probe.js';

/**
 * View exposed to analyzers via `context.forKind('cpu')`. Lets finding
 * analyzers reach the hotspot analysis and timed samples without recomputing.
 */
export interface CpuAnalysisView {
  data: CpuKindData;
  bundle: CaptureBundle;
  tree: EnrichedTree;
  hotspotAnalysis: HotspotAnalysis;
  timedSamples: TimedSample[];
}

declare module '../core/types.js' {
  interface KindViews {
    cpu: CpuAnalysisView;
  }
}

export interface CpuAnalysisContributorOptions {
  /** V8 sampling interval in microseconds; same value the probe used. */
  sampleIntervalMicros: number;
}

export function createCpuAnalysisContributor(
  options: CpuAnalysisContributorOptions,
): KindAnalysisContributor<CpuKindData> {
  const { sampleIntervalMicros } = options;
  return {
    analyze(ctx: KindAnalysisContext<CpuKindData>) {
      const { data, bundle } = ctx;
      const tree = enrichCpuTree(data.cpuProfile, bundle.target.cwd, sampleIntervalMicros);
      const hotspotAnalysis = buildHotspotAnalysis(data.cpuProfile, tree);
      const timedSamples = buildTimedSamples(data.cpuProfile, sampleIntervalMicros);

      const gc: GcReport = buildGcReport(bundle.runtimeSignals.gcEvents);
      const gcCorrelation = correlateUserHotspotsWithCoverage(
        timedSamples,
        tree,
        buildGcCorrelationWindows(bundle.runtimeSignals.gcEvents, bundle.durationMs),
      );
      if (gcCorrelation.hotspots.length > 0) gc.correlatedHotspots = gcCorrelation.hotspots;
      if (gcCorrelation.coverage.windowCount > 0) gc.correlationCoverage = gcCorrelation.coverage;

      const hotStacks = computeHotStacks(data.cpuProfile, tree);
      const hotStackClusters = clusterHotStacksByUserAnchor(hotStacks);

      const eventLoop: EventLoopReport = buildEventLoopReport(bundle);
      const eventLoopCorrelation = correlateUserHotspotsWithCoverage(
        timedSamples,
        tree,
        eventLoop.stallIntervals,
      );
      if (eventLoopCorrelation.hotspots.length > 0) {
        eventLoop.correlatedHotspots = eventLoopCorrelation.hotspots;
      }
      if (eventLoopCorrelation.coverage.windowCount > 0) {
        eventLoop.correlationCoverage = eventLoopCorrelation.coverage;
      }

      const summary = buildCpuSummary(tree);
      const quality = buildCpuProfileQuality({
        sampleCount: tree.totalSamples,
        durationMs: bundle.durationMs,
        idleRatio: summary.idleRatio,
        samplesTimed: data.samplesTimed,
      });

      const section: CpuProfileReport = {
        summary,
        hotspots: hotspotAnalysis.publicHotspots,
        hotStacks,
        ...(hotStackClusters.length > 0 ? { hotStackClusters } : {}),
        gc,
        eventLoop,
        quality,
        deopts: enrichDeopts(data.deopts),
      };

      ctx.writeSection<CpuProfileReport>(section);
      const view: CpuAnalysisView = {
        data,
        bundle,
        tree,
        hotspotAnalysis,
        timedSamples,
      };
      ctx.setContextView<CpuAnalysisView>(view);
    },
  };
}

export const cpuFinalize: KindFinalizeHook<CpuKindData> = ({ snapshot }) => {
  const cpu = (snapshot.profiles as Partial<ProfileSectionMap>).cpu;
  if (!cpu) return;
  cpu.summary.dominantBlockingKind = deriveDominantBlockingKind(snapshot.findings);
  cpu.summary.topUserHotspot = deriveTopUserHotspot(
    cpu.hotspots,
    cpu.eventLoop.correlatedHotspots ?? [],
    snapshot.findings,
  );
};

export type { KindViews };
