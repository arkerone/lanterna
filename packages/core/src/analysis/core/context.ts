import type { CaptureBundle } from '../../capture/core/types.js';
import type { KindViews, ProfileKind } from '../../kinds/core/types.js';
import type { AnalysisContext, AnalysisOptions } from './types.js';

export interface MutableAnalysisContext extends AnalysisContext {
  setView<K extends keyof KindViews>(id: K, view: KindViews[K]): void;
}

export function createAnalysisContext(
  bundle: CaptureBundle,
  options: AnalysisOptions,
  kinds: ReadonlyArray<Pick<ProfileKind, 'id' | 'reportSectionKey'>> = [],
): MutableAnalysisContext {
  const views = new Map<string, unknown>();
  const reportSectionKeys = new Map(kinds.map((kind) => [kind.id, kind.reportSectionKey]));
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
    reportSectionKeyForKind(id) {
      const sectionKey = reportSectionKeys.get(id as string);
      if (sectionKey === undefined) {
        throw new Error(`profile kind "${String(id)}" is not registered in this analysis context`);
      }
      return sectionKey;
    },
    setView(id, view) {
      views.set(id as string, view);
    },
  };
}
