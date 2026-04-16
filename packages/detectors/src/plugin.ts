import type { AnalysisContext, AnalysisPipeline, FindingAnalyzer } from '@lanterna/core';
import type { Detector, FindingContext } from './detectors/types.js';

export interface LanternaPluginContext {
  readonly cwd: string;
  readonly mode: 'spawn' | 'attach';
}

export type LanternaDetectorPlugin = (
  pipeline: AnalysisPipeline,
  ctx: LanternaPluginContext,
) => void | Promise<void>;

export function createFindingAnalyzerFromDetector(detector: Detector): FindingAnalyzer {
  return {
    id: detector.id,
    kind: 'finding',
    ...(detector.order !== undefined ? { order: detector.order } : {}),
    run(context, snapshot) {
      return detector.detect(snapshot, buildFindingContext(context));
    },
  };
}

export function buildFindingContext(context: AnalysisContext): FindingContext {
  const hotspotAnalysis = context.getHotspotAnalysis();
  return {
    fullHotspots: hotspotAnalysis.fullHotspots,
    hotspotById: hotspotAnalysis.hotspotById,
    userAttributionById: hotspotAnalysis.userAttributionById,
  };
}
