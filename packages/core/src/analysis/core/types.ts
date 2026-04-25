import type { CaptureBundle } from '../../capture/core/types.js';
import type { KindViews, ProfileSectionMap } from '../../kinds/core/types.js';
import type { Finding, LanternaReport } from '../../report/types.js';

/**
 * Options shared by every analyzer at pipeline run time. Kind-agnostic by
 * design — kind-specific config (sampling intervals, depth flags, etc.) is
 * closed over by each kind at construction.
 */
export interface AnalysisOptions {
  command: string[];
  mode?: LanternaReport['meta']['mode'];
}

export type ExtensionEntry = unknown;
export type ExtensionMap = Record<string, ExtensionEntry>;

/**
 * Output of {@link AnalysisPipeline.run} — excludes `meta` which is assembled
 * separately by `buildLanternaReport`.
 */
export interface AnalysisResult {
  profiles: Partial<ProfileSectionMap>;
  findings: Finding[];
  extensions?: ExtensionMap;
}

/**
 * The mutable snapshot analyzers work against. Section analyzers writing into
 * `profiles[kindKey]` own that slot's shape; finding analyzers read the
 * fully-populated profiles map.
 */
export interface AnalysisSnapshot {
  meta: LanternaReport['meta'];
  profiles: Partial<ProfileSectionMap>;
  findings: Finding[];
  extensions: ExtensionMap;
}

export interface AnalysisContext {
  readonly bundle: CaptureBundle;
  readonly options: AnalysisOptions;
  /**
   * Access the typed analysis view installed by a kind's contributor. Throws
   * if the kind wasn't part of the capture or didn't publish a view.
   */
  forKind<K extends keyof KindViews>(id: K): KindViews[K];
  /** `true` when the kind has a view registered. */
  hasKind<K extends keyof KindViews>(id: K): boolean;
}

export interface BaseAnalyzer {
  id: string;
  order?: number;
}

/**
 * A section analyzer writes under a namespace inside `snapshot.extensions`.
 * Kind-specific data lives in `snapshot.profiles.<kindKey>` instead and is
 * produced by {@link KindAnalysisContributor}s, not section analyzers.
 */
export interface SectionAnalyzer<TSection = ExtensionEntry> extends BaseAnalyzer {
  kind: 'section';
  namespace: string;
  run(context: AnalysisContext, snapshot: Readonly<AnalysisSnapshot>): TSection;
}

export interface FindingAnalyzer extends BaseAnalyzer {
  kind: 'finding';
  run(context: AnalysisContext, snapshot: Readonly<AnalysisSnapshot>): Finding[];
}
