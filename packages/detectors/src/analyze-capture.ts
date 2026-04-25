import {
  type AnalysisOptions,
  type AnalysisPipeline,
  type AnalysisResult,
  type CaptureBundle,
  createDefaultAnalysisPipeline as createCoreDefaultAnalysisPipeline,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { createBuiltInFindingAnalyzers } from './detectors/index.js';

/**
 * Convenience for analyzing a {@link CaptureBundle} captured with the kinds
 * passed in. Builds a fresh pipeline (kinds + built-in CPU detectors) per
 * call — kind options are closed over at construction, so a singleton
 * pipeline can't service different runs.
 *
 * If you only have a CPU kind, pass it in `kinds`; the helper does NOT
 * fabricate a CPU kind for you anymore (it would silently ignore options
 * like `deep` that the caller may need).
 */
export function analyzeCapture(
  bundle: CaptureBundle,
  options: AnalysisOptions,
  kinds: ProfileKind[],
): AnalysisResult {
  return createDefaultAnalysisPipeline(kinds).run(bundle, options);
}

/**
 * Builds an analysis pipeline pre-registered with the given kinds and the
 * built-in CPU finding analyzers. Pass `kinds` to keep behaviour explicit —
 * core no longer assumes CPU.
 */
export function createDefaultAnalysisPipeline(kinds: ProfileKind[]): AnalysisPipeline {
  return createCoreDefaultAnalysisPipeline({
    kinds,
    analyzers: createBuiltInFindingAnalyzers(),
  });
}
