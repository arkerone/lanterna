import {
  type AnalysisOptions,
  type AnalysisPipeline,
  type AnalysisResult,
  createAnalysisPipeline,
  type RawCapture,
} from '@lanterna-profiler/core';
import { createBuiltInFindingAnalyzers } from './detectors/index.js';

let defaultPipeline: AnalysisPipeline | undefined;

/**
 * Runs all built-in detectors on a raw capture and returns the analysis result.
 *
 * Uses a lazily-initialized shared pipeline. For programmatic use cases that
 * need a fresh pipeline or custom analyzers, use {@link createDefaultAnalysisPipeline}
 * directly.
 */
export function analyzeCapture(rawCapture: RawCapture, options: AnalysisOptions): AnalysisResult {
  defaultPipeline ??= createDefaultAnalysisPipeline();
  return defaultPipeline.run(rawCapture, options);
}

/**
 * Creates a new {@link AnalysisPipeline} pre-loaded with all built-in finding
 * analyzers. Use this when you need a fresh pipeline you can extend with
 * custom analyzers or plugins before running it.
 */
export function createDefaultAnalysisPipeline(): AnalysisPipeline {
  return createAnalysisPipeline({
    findingAnalyzers: createBuiltInFindingAnalyzers(),
  });
}
