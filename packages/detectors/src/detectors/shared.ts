import type {
  AlternativeHotspotEvidence,
  AttributionEvidence,
  BaseFinding,
  BlockingIoEvidenceExtra,
  BuiltinFindingCategory,
  CpuAnalysisView,
  EventLoopReport,
  FindingMeasurements,
  FindingRemediation,
  Hotspot,
  HotspotAttribution,
  JsonHotPathEvidenceExtra,
  NodeModulesHotspotEvidenceExtra,
  RequireInHotPathEvidenceExtra,
  StallCorrelation,
  SyncCryptoEvidenceExtra,
} from '@lanterna-profiler/core';

/**
 * Subset of {@link CpuAnalysisView}'s hotspot analysis used by detector helpers.
 * Detectors receive this via `kinds.cpu.view.hotspotAnalysis` from the
 * `KindScopedDetector<'cpu'>` wrapper.
 */
export type CpuHotspotContext = Pick<
  CpuAnalysisView['hotspotAnalysis'],
  'fullHotspots' | 'hotspotById' | 'userAttributionById'
>;

export interface ResolvedAttribution {
  attribution: HotspotAttribution | undefined;
  caller: HotspotAttribution | undefined;
}

/**
 * Resolves the user-code caller most likely responsible for a non-user hotspot.
 *
 * Returns `caller` only when attribution confidence is `'high'` (the user
 * frame appears on ≥80% of the hotspot's sampled call paths). Use `attribution`
 * when you need to surface the candidate regardless of confidence.
 */
export function resolveAttribution(
  hotspot: Hotspot,
  context: CpuHotspotContext,
): ResolvedAttribution {
  const attribution = context.userAttributionById.get(hotspot.id);
  const caller = attribution?.confidence === 'high' ? attribution : undefined;
  return { attribution, caller };
}

export function findStallCorrelation(
  caller: { file: string; line: number; function: string } | undefined,
  report: { eventLoop: EventLoopReport },
): StallCorrelation | undefined {
  if (!caller) return undefined;
  const match = report.eventLoop.correlatedHotspots?.find(
    (candidate) =>
      candidate.file === caller.file &&
      candidate.line === caller.line &&
      candidate.function === caller.function,
  );
  if (!match) return undefined;
  return { overlapPct: match.overlapPct, samplePct: match.samplePct };
}

export function buildAttributionEvidence(
  attribution: HotspotAttribution | undefined,
  caller: HotspotAttribution | undefined,
): AttributionEvidence {
  return {
    proofLevel: caller ? 'attributed-caller' : 'direct-builtin',
    attributionBasis: caller ? 'sample-path' : 'builtin-only',
    attributionConfidence: caller?.confidence ?? 'low',
    userAttribution: attribution,
  };
}

export function toAlternativeHotspotEvidence(hotspot: Hotspot): AlternativeHotspotEvidence {
  return {
    id: hotspot.id,
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    selfPct: hotspot.selfPct,
    totalPct: hotspot.totalPct,
  };
}

/**
 * Aggregates matching hotspots into a per-API breakdown and a category total.
 *
 * Why: individual frames may each sit below the per-API threshold while the
 * cumulative CPU across a family (e.g. all sync fs APIs together) is
 * significant. An agent should see that story, not miss it because no single
 * frame crossed 1%. Callers use the per-API buckets to emit findings and
 * `categoryTotalPct` as context in the finding's evidence.
 */
export function aggregateByPatterns<TPattern extends { re: RegExp; api: string }>(
  hotspots: readonly Hotspot[],
  patterns: ReadonlyArray<TPattern>,
  options: {
    /** Restrict to these hotspot categories (defaults to builtin+native). */
    categories?: ReadonlyArray<Hotspot['category']>;
    /** Pre-normalised function name (strips opt prefix). */
    normalize?: (name: string) => string;
  } = {},
): {
  readonly byApi: ReadonlyMap<string, { api: string; hotspots: Hotspot[]; totalPct: number }>;
  readonly categoryTotalPct: number;
  readonly categorySelfPct: number;
} {
  const categories = options.categories ?? (['node:builtin', 'native'] as const);
  const normalize = options.normalize ?? ((name: string) => name);
  const byApi = new Map<string, { api: string; hotspots: Hotspot[]; totalPct: number }>();
  let categoryTotalPct = 0;
  let categorySelfPct = 0;
  for (const hotspot of hotspots) {
    // Defense in depth: lanterna's own instrumentation must never produce a
    // detector finding, even if a caller passes a permissive `categories` list.
    if (hotspot.category === 'lanterna') continue;
    if (!categories.includes(hotspot.category)) continue;
    const normalized = normalize(hotspot.function);
    const match = patterns.find((p) => p.re.test(normalized));
    if (!match) continue;
    categoryTotalPct += hotspot.totalPct;
    categorySelfPct += hotspot.selfPct;
    const bucket = byApi.get(match.api);
    if (bucket) {
      bucket.hotspots.push(hotspot);
      bucket.totalPct += hotspot.totalPct;
    } else {
      byApi.set(match.api, { api: match.api, hotspots: [hotspot], totalPct: hotspot.totalPct });
    }
  }
  return { byApi, categoryTotalPct, categorySelfPct };
}

export function resolveEvidenceField<K extends 'file' | 'line' | 'function'>(
  caller: HotspotAttribution | undefined,
  hotspot: Hotspot,
  field: K,
): Hotspot[K] {
  return (caller?.[field] ?? hotspot[field]) as Hotspot[K];
}

type AttributedFindingExtra =
  | BlockingIoEvidenceExtra
  | SyncCryptoEvidenceExtra
  | JsonHotPathEvidenceExtra
  | NodeModulesHotspotEvidenceExtra
  | RequireInHotPathEvidenceExtra;

/**
 * Builds the `BaseFinding` object for the five builtin categories that follow
 * the "hotspot with user attribution" pattern:
 * `blocking-io`, `sync-crypto`, `json-on-hot-path`, `node-modules-hotspot`,
 * `require-in-hot-path`.
 *
 * The evidence `file`/`line`/`function` fields are resolved to the caller when
 * attribution confidence is high, falling back to the hotspot itself otherwise.
 * Wrap the result in `defineBuiltinFinding()` before returning from a detector.
 */
export function buildAttributedFinding<
  C extends Extract<
    BuiltinFindingCategory,
    | 'blocking-io'
    | 'sync-crypto'
    | 'json-on-hot-path'
    | 'node-modules-hotspot'
    | 'require-in-hot-path'
  >,
>(options: {
  id: string;
  category: C;
  severity: BaseFinding['severity'];
  title: string;
  hotspot: Hotspot;
  caller: HotspotAttribution | undefined;
  selfPct: number;
  why: string;
  suggestion: string;
  references: string[];
  extra: AttributedFindingExtra;
  measurements?: FindingMeasurements;
  remediation?: FindingRemediation;
}): BaseFinding<
  C,
  C extends 'blocking-io'
    ? BlockingIoEvidenceExtra
    : C extends 'sync-crypto'
      ? SyncCryptoEvidenceExtra
      : C extends 'json-on-hot-path'
        ? JsonHotPathEvidenceExtra
        : C extends 'node-modules-hotspot'
          ? NodeModulesHotspotEvidenceExtra
          : RequireInHotPathEvidenceExtra
> {
  const {
    id,
    category,
    severity,
    title,
    hotspot,
    caller,
    selfPct,
    why,
    suggestion,
    references,
    extra,
    measurements,
    remediation,
  } = options;

  return {
    id,
    profileKind: 'cpu',
    severity,
    category,
    title,
    evidence: {
      file: resolveEvidenceField(caller, hotspot, 'file'),
      line: resolveEvidenceField(caller, hotspot, 'line'),
      function: resolveEvidenceField(caller, hotspot, 'function'),
      selfPct,
      extra: extra as C extends 'blocking-io'
        ? BlockingIoEvidenceExtra
        : C extends 'sync-crypto'
          ? SyncCryptoEvidenceExtra
          : C extends 'json-on-hot-path'
            ? JsonHotPathEvidenceExtra
            : C extends 'node-modules-hotspot'
              ? NodeModulesHotspotEvidenceExtra
              : RequireInHotPathEvidenceExtra,
    },
    measurements,
    remediation,
    why,
    suggestion,
    references,
  };
}
