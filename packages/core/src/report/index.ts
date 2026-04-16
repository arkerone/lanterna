import type { RawCapture } from '../capture/core/types.js';
import type { AnalysisOptions, AnalysisResult } from '../analysis/core/types.js';
import { buildReportMeta } from './meta.js';
import { serializeReport } from './serialize.js';
import type { LanternaReport } from './types.js';

/**
 * Assembles a {@link LanternaReport} from a raw capture and its analysis result.
 *
 * This is the final step in the programmatic profiling pipeline:
 * `startSpawnCapture` / `startAttachCapture` → `AnalysisPipeline.run` →
 * `buildLanternaReport` → `serializeReport`.
 */
export function buildLanternaReport(
  rawCapture: RawCapture,
  analysis: AnalysisResult,
  options: AnalysisOptions,
): LanternaReport {
  const report: LanternaReport = {
    meta: buildReportMeta(rawCapture, { totalSamples: countTotalSamples(rawCapture) }, options),
    summary: analysis.summary,
    hotspots: analysis.hotspots,
    hotStacks: analysis.hotStacks,
    gc: analysis.gc,
    eventLoop: analysis.eventLoop,
    deopts: analysis.deopts,
    findings: analysis.findings,
  };

  if (analysis.extensions && Object.keys(analysis.extensions).length > 0) {
    report.extensions = analysis.extensions;
  }

  return report;
}

export { serializeReport };
export * from './types.js';

function countTotalSamples(rawCapture: RawCapture): number {
  return rawCapture.cpuProfile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
}
