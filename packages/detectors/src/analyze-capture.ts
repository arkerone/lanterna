import {
  AnalysisPipeline,
  createAnalysisPipeline,
  type AnalysisOptions,
  type AnalysisResult,
  type RawCapture,
} from '@lanterna/core';
import { createBuiltInFindingAnalyzers } from './detectors/index.js';

let defaultPipeline: AnalysisPipeline | undefined;

export function analyzeCapture(
  rawCapture: RawCapture,
  options: AnalysisOptions,
): AnalysisResult {
  defaultPipeline ??= createDefaultAnalysisPipeline();
  return defaultPipeline.run(rawCapture, options);
}

export function createDefaultAnalysisPipeline(): AnalysisPipeline {
  return createAnalysisPipeline({
    findingAnalyzers: createBuiltInFindingAnalyzers(),
  });
}
