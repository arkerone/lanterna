import type { FindingAnalyzer, ProfileKind, SectionAnalyzer } from '@lanterna-profiler/core';
import { createBuiltInAsyncFindingAnalyzers } from './detectors/async/index.js';
import { createBuiltInFindingAnalyzers } from './detectors/cpu/index.js';
import { createBuiltInMemoryFindingAnalyzers } from './detectors/memory/index.js';

type BuiltInAnalyzer = FindingAnalyzer | SectionAnalyzer;

const defaultAnalyzerFactories: Record<string, () => BuiltInAnalyzer[]> = {
  async: createBuiltInAsyncFindingAnalyzers,
  cpu: createBuiltInFindingAnalyzers,
  memory: createBuiltInMemoryFindingAnalyzers,
};

export function appendBuiltInAnalyzers<TData>(
  kind: ProfileKind<TData>,
  analyzers: readonly BuiltInAnalyzer[],
): ProfileKind<TData> {
  return {
    ...kind,
    builtInAnalyzers: [...(kind.builtInAnalyzers ?? []), ...analyzers],
  };
}

export function collectBuiltInAnalyzers(kinds: readonly ProfileKind[]): BuiltInAnalyzer[] {
  return kinds.flatMap((kind) => kind.builtInAnalyzers ?? defaultAnalyzersForKind(kind));
}

function defaultAnalyzersForKind(kind: ProfileKind): BuiltInAnalyzer[] {
  return defaultAnalyzerFactories[kind.id]?.() ?? [];
}
