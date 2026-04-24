import { type AnalysisPipeline, createAnalysisPipeline } from '../analysis/core/pipeline.js';
import type { FindingAnalyzer, SectionAnalyzer } from '../analysis/core/types.js';
import type { ProfileKind } from '../kinds/core/types.js';
import { createCpuProfileKind } from '../kinds/cpu/index.js';
import type { ProfilePipelinePlugin } from './types.js';

export interface DefaultAnalysisPipelineOptions {
  kinds?: ProfileKind[];
  analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
}

/**
 * Creates a pipeline with the built-in CPU kind. Finding analyzers are
 * intentionally injected by callers, so core stays independent from detector
 * packs.
 */
export function createDefaultAnalysisPipeline(
  options: DefaultAnalysisPipelineOptions | ProfileKind[] = {},
): AnalysisPipeline {
  const normalized = Array.isArray(options) ? { kinds: options } : options;
  const kinds = normalized.kinds ?? [
    createCpuProfileKind({
      readStderrSoFar: () => '',
    }),
  ];
  const pipeline = createAnalysisPipeline({ kinds });
  for (const analyzer of normalized.analyzers ?? []) {
    pipeline.register(analyzer);
  }
  return pipeline;
}

export async function configureProfilePipeline(
  options: {
    kinds: ProfileKind[];
    analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
    setupPipeline?: ProfilePipelinePlugin;
  },
  mode: 'spawn' | 'attach',
): Promise<AnalysisPipeline> {
  const pipeline = createDefaultAnalysisPipeline({
    kinds: options.kinds,
    analyzers: options.analyzers,
  });
  if (options.setupPipeline) {
    await options.setupPipeline(pipeline, { cwd: process.cwd(), mode });
  }
  return pipeline;
}
