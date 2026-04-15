import { syncCryptoDetector } from './sync-crypto.js';
import { blockingIoDetector } from './blocking-io.js';
import { excessiveGcDetector } from './excessive-gc.js';
import { eventLoopStallDetector } from './event-loop-stall.js';
import { deoptLoopDetector } from './deopt-loop.js';
import { requireInHotPathDetector } from './require-in-hot-path.js';
import { jsonOnHotPathDetector } from './json-on-hot-path.js';
import { nodeModulesHotspotDetector } from './node-modules-hotspot.js';
import { cpuBoundUserHotspotDetector } from './cpu-bound-user-hotspot.js';
import type { Detector, FindingContext } from './types.js';
import type { AnalysisContext, FindingAnalyzer } from '../core/types.js';

export const DETECTORS: Detector[] = [
  syncCryptoDetector,
  blockingIoDetector,
  jsonOnHotPathDetector,
  excessiveGcDetector,
  eventLoopStallDetector,
  deoptLoopDetector,
  requireInHotPathDetector,
  nodeModulesHotspotDetector,
  cpuBoundUserHotspotDetector,
];

export function createBuiltInFindingAnalyzers(): FindingAnalyzer[] {
  return DETECTORS.map((detector) => ({
    id: detector.id,
    kind: 'finding',
    order: detector.order,
    run(context, snapshot) {
      return detector.detect(snapshot, buildFindingContext(context));
    },
  }));
}

function buildFindingContext(context: AnalysisContext): FindingContext {
  const hotspotAnalysis = context.getHotspotAnalysis();
  return {
    fullHotspots: hotspotAnalysis.fullHotspots,
    hotspotById: hotspotAnalysis.hotspotById,
    userAttributionById: hotspotAnalysis.userAttributionById,
  };
}
