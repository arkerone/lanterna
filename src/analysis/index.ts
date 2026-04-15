import type { RawCapture } from '../capture/core/types.js';
import type { AnalysisOptions, AnalysisResult } from './core/types.js';
import { AnalysisPipeline, createDefaultAnalysisPipeline } from './core/pipeline.js';

let defaultPipeline: AnalysisPipeline | undefined;

export function analyzeCapture(
  rawCapture: RawCapture,
  options: AnalysisOptions,
): AnalysisResult {
  defaultPipeline ??= createDefaultAnalysisPipeline();
  return defaultPipeline.run(rawCapture, options);
}

export {
  AnalysisPipeline,
  createAnalysisPipeline,
  createDefaultAnalysisPipeline,
  defineFindingAnalyzer,
  defineSectionAnalyzer,
} from './core/pipeline.js';
export type {
  AnalysisContext,
  AnalysisOptions,
  AnalysisResult,
  AnalysisSnapshot,
  ExtensionEntry,
  ExtensionMap,
  FindingAnalyzer,
  SectionAnalyzer,
} from './core/types.js';
