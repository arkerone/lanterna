import { type AnalysisPipeline, createAnalysisPipeline } from '../analysis/core/pipeline.js';
import type { FindingAnalyzer, SectionAnalyzer } from '../analysis/core/types.js';
import type { ProfileKind } from '../kinds/core/types.js';
import type { ProfilePipelinePlugin } from './types.js';

export interface DefaultAnalysisPipelineOptions {
  kinds: ProfileKind[];
  analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
}

/**
 * Builds an {@link AnalysisPipeline} configured with the given kinds and
 * analyzers. Core stays kind-agnostic — callers provide the kinds they
 * captured (CPU is no longer assumed).
 */
export function createDefaultAnalysisPipeline(
  options: DefaultAnalysisPipelineOptions,
): AnalysisPipeline {
  const pipeline = createAnalysisPipeline({ kinds: options.kinds });
  for (const analyzer of options.analyzers ?? []) {
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
