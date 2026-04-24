import type { CaptureBundle } from '../../capture/core/types.js';
import type { KindViews } from '../../kinds/core/types.js';
import type { AnalysisContext, AnalysisOptions } from './types.js';

export interface MutableAnalysisContext extends AnalysisContext {
  setView<K extends keyof KindViews>(id: K, view: KindViews[K]): void;
}

export function createAnalysisContext(
  bundle: CaptureBundle,
  options: AnalysisOptions,
): MutableAnalysisContext {
  const views = new Map<string, unknown>();
  return {
    bundle,
    options,
    hasKind(id) {
      return views.has(id as string);
    },
    forKind(id) {
      const view = views.get(id as string);
      if (view === undefined) {
        throw new Error(
          `profile kind "${String(id)}" is not available in this analysis context; did the kind run?`,
        );
      }
      return view as KindViews[typeof id];
    },
    setView(id, view) {
      views.set(id as string, view);
    },
  };
}
