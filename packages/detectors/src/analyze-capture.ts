import {
  type AnalysisOptions,
  type AnalysisPipeline,
  type AnalysisResult,
  type CaptureBundle,
  createDefaultAnalysisPipeline as createCoreDefaultAnalysisPipeline,
  createCpuProfileKind,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { createBuiltInFindingAnalyzers } from './detectors/index.js';

let defaultPipeline: AnalysisPipeline | undefined;

/**
 * Runs the default pipeline (CPU kind + all built-in detectors) on a capture.
 */
export function analyzeCapture(bundle: CaptureBundle, options: AnalysisOptions): AnalysisResult {
  defaultPipeline ??= createDefaultAnalysisPipeline();
  return defaultPipeline.run(bundle, options);
}

/**
 * Creates a new {@link AnalysisPipeline} pre-registered with the CPU kind and
 * all built-in finding analyzers. Pass extra `kinds` to add more.
 */
export function createDefaultAnalysisPipeline(extraKinds: ProfileKind[] = []): AnalysisPipeline {
  const cpuKind = createCpuProfileKind({
    // The analysis pipeline doesn't have access to a stderr buffer — this
    // stub is a no-op. During full profiling, the caller should construct the
    // kind with a real stderr reader.
    readStderrSoFar: () => '',
  });
  return createCoreDefaultAnalysisPipeline({
    kinds: [cpuKind, ...extraKinds],
    analyzers: createBuiltInFindingAnalyzers(),
  });
}
