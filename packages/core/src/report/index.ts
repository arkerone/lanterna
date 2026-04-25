import type { AnalysisOptions, AnalysisResult } from '../analysis/core/types.js';
import type { CaptureBundle } from '../capture/core/types.js';
import type { ProfileKind } from '../kinds/core/types.js';
import { buildReportMeta } from './meta.js';
import { serializeReport } from './serialize.js';
import type { LanternaReport } from './types.js';

/**
 * Assembles a {@link LanternaReport} from a capture bundle and its analysis
 * result. The final step in the programmatic pipeline:
 * `runCapture` → `AnalysisPipeline.run` → `buildLanternaReport` → `serializeReport`.
 */
export function buildLanternaReport(
  bundle: CaptureBundle,
  analysis: AnalysisResult,
  kinds: ReadonlyArray<ProfileKind>,
  options: AnalysisOptions,
): LanternaReport {
  const report: LanternaReport = {
    meta: buildReportMeta(bundle, kinds, options),
    profiles: analysis.profiles,
    findings: analysis.findings,
  };
  if (analysis.extensions && Object.keys(analysis.extensions).length > 0) {
    report.extensions = analysis.extensions;
  }
  return report;
}

export * from './types.js';
export { serializeReport };
