import type { KindViews, ProfileSectionMap } from '../kinds/core/types.js';
import type { Finding, ReportMeta } from '../report/types.js';
import type { AnalysisContext, AnalysisSnapshot, FindingAnalyzer } from './core/types.js';

/**
 * Shared context passed to a kind-scoped detector alongside its kind views.
 * Crosscutting info that isn't owned by any single kind.
 */
export interface KindScopedDetectorShared {
  readonly findings: readonly Finding[];
  readonly meta: ReportMeta;
}

export type KindScopedDetectorBundle<K extends keyof ProfileSectionMap> = {
  [I in K]: {
    readonly report: ProfileSectionMap[I];
    readonly view: KindViews[I];
  };
};

/**
 * A detector scoped to one or more profile kinds. The wrapper guards on
 * `hasKind` for every id in `kindIds`, then provides a typed record of
 * `{ report, view }` per kind plus crosscutting `shared` info.
 *
 * For single-kind detectors, use `KindScopedDetector<'cpu'>`; the wrapper
 * still delivers a record — access via `kinds.cpu.report` etc.
 */
export interface KindScopedDetector<K extends keyof ProfileSectionMap> {
  id: string;
  kindIds: readonly K[];
  order?: number;
  detect(kinds: KindScopedDetectorBundle<K>, shared: KindScopedDetectorShared): Finding[];
}

/**
 * Wraps a {@link KindScopedDetector} as a {@link FindingAnalyzer}. The wrapper:
 * - returns `[]` when any declared kind is absent from the capture,
 * - builds the typed `{ [kindId]: { report, view } }` record,
 * - auto-tags findings with `profileKind: detector.kindIds[0]` when unset.
 */
export function createFindingAnalyzerFromKindScopedDetector<K extends keyof ProfileSectionMap>(
  detector: KindScopedDetector<K>,
): FindingAnalyzer {
  return {
    id: detector.id,
    kind: 'finding',
    ...(detector.order !== undefined ? { order: detector.order } : {}),
    run(context: AnalysisContext, snapshot: Readonly<AnalysisSnapshot>) {
      for (const kindId of detector.kindIds) {
        if (!context.hasKind(kindId)) return [];
        if (snapshot.profiles[context.reportSectionKeyForKind(kindId)] === undefined) return [];
      }
      const bundle = {} as KindScopedDetectorBundle<K>;
      for (const kindId of detector.kindIds) {
        const sectionKey = context.reportSectionKeyForKind(kindId);
        (bundle as Record<string, { report: unknown; view: unknown }>)[kindId as string] = {
          report: snapshot.profiles[sectionKey] as ProfileSectionMap[typeof kindId],
          view: context.forKind(kindId),
        };
      }
      const shared: KindScopedDetectorShared = {
        findings: snapshot.findings,
        meta: snapshot.meta,
      };
      const primaryKind = detector.kindIds[0] as string;
      return detector.detect(bundle, shared).map((finding) => ({
        ...finding,
        profileKind: finding.profileKind ?? primaryKind,
      })) as Finding[];
    },
  };
}
