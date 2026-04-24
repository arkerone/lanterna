import type {
  AnalysisContext,
  AnalysisPipeline,
  CpuAnalysisView,
  CpuProfileReport,
  Finding,
  FindingAnalyzer,
} from '@lanterna-profiler/core';
import type { CpuDetectorReport, Detector, FindingContext } from './detectors/types.js';

export interface LanternaPluginContext {
  readonly cwd: string;
  readonly mode: 'spawn' | 'attach';
}

export type LanternaDetectorPlugin = (
  pipeline: AnalysisPipeline,
  ctx: LanternaPluginContext,
) => void | Promise<void>;

/**
 * Wraps a CPU {@link Detector} into a {@link FindingAnalyzer}. The detector
 * receives a CPU-shaped report view (`report.hotspots`, `report.gc`, …) and
 * returned findings are auto-tagged `profileKind: 'cpu'`.
 */
export function createFindingAnalyzerFromDetector(detector: Detector): FindingAnalyzer {
  return {
    id: detector.id,
    kind: 'finding',
    ...(detector.order !== undefined ? { order: detector.order } : {}),
    run(context, snapshot) {
      if (!context.hasKind('cpu')) return [];
      const cpu = snapshot.profiles.cpu as CpuProfileReport | undefined;
      if (!cpu) return [];
      const report: CpuDetectorReport = {
        ...cpu,
        meta: snapshot.meta,
        findings: snapshot.findings,
      };
      const findingContext = buildFindingContext(context);
      return detector.detect(report, findingContext).map((finding) => ({
        ...finding,
        profileKind: finding.profileKind ?? 'cpu',
      })) as Finding[];
    },
  };
}

export function buildFindingContext(context: AnalysisContext): FindingContext {
  const view = context.forKind('cpu') as CpuAnalysisView;
  return {
    fullHotspots: view.hotspotAnalysis.fullHotspots,
    hotspotById: view.hotspotAnalysis.hotspotById,
    userAttributionById: view.hotspotAnalysis.userAttributionById,
  };
}
