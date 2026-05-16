import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
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
  JsonHotPathEvidenceExtra,
  NodeModulesHotspotEvidenceExtra,
  RequireInHotPathEvidenceExtra,
  StallCorrelation,
  SyncCryptoEvidenceExtra,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import { isNoiseCategory } from '@lanterna-profiler/core';

/**
 * Subset of {@link CpuAnalysisView}'s hotspot analysis used by detector helpers.
 * Detectors receive this via `kinds.cpu.view.hotspotAnalysis` from the
 * `KindScopedDetector<'cpu'>` wrapper.
 */
export type CpuHotspotContext = Pick<
  CpuAnalysisView['hotspotAnalysis'],
  'fullHotspots' | 'hotspotById' | 'userCallerById' | 'candidateCallersById'
>;

export interface ResolvedAttribution {
  attribution: UserCallerAttribution | undefined;
  caller: UserCallerAttribution | undefined;
  candidateCallers: UserCallerAttribution[];
}

export const BUILTIN_RUNTIME_CATEGORIES = ['node:builtin', 'native'] as const;

export function isBuiltinRuntimeHotspot(hotspot: Hotspot): boolean {
  return matchesHotspotCategory(hotspot, BUILTIN_RUNTIME_CATEGORIES);
}

export function matchesHotspotCategory(
  hotspot: Hotspot,
  categories: ReadonlyArray<Hotspot['category']>,
): boolean {
  if (isNoiseCategory(hotspot.category)) return false;
  return categories.includes(hotspot.category);
}

export function maxHotspotPct(hotspot: Pick<Hotspot, 'selfPct' | 'totalPct'>): number {
  return Math.max(hotspot.selfPct, hotspot.totalPct);
}

export function severityForPct(observedPct: number, criticalPct: number): BaseFinding['severity'] {
  return observedPct > criticalPct ? 'critical' : 'warning';
}

export function exceedsAnyHotspotThreshold(
  hotspot: Pick<Hotspot, 'selfPct' | 'totalPct'>,
  thresholds: { minSelfPct?: number; minTotalPct?: number },
): boolean {
  const selfHit = thresholds.minSelfPct !== undefined && hotspot.selfPct >= thresholds.minSelfPct;
  const totalHit =
    thresholds.minTotalPct !== undefined && hotspot.totalPct >= thresholds.minTotalPct;
  return selfHit || totalHit;
}

export function exceedsCategoryThreshold(categoryTotalPct: number, thresholdPct: number): boolean {
  return categoryTotalPct >= thresholdPct;
}

export function findActionableUserCpuHotspot(
  hotspots: readonly Hotspot[],
  minTotalPct = 1,
): Hotspot | undefined {
  return hotspots.find((hotspot) => hotspot.category === 'user' && hotspot.totalPct > minTotalPct);
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
  const attribution = context.userCallerById.get(hotspot.id);
  const candidateCallers = context.candidateCallersById?.get(hotspot.id) ?? [];
  const caller = attribution?.confidence === 'high' ? attribution : undefined;
  return { attribution, caller, candidateCallers };
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
  attribution: UserCallerAttribution | undefined,
  caller: UserCallerAttribution | undefined,
  candidateCallers: readonly UserCallerAttribution[] = attribution ? [attribution] : [],
): AttributionEvidence {
  const candidateCallerEvidence =
    candidateCallers.length > 0 ? [...candidateCallers] : attribution ? [attribution] : undefined;
  return {
    proofLevel: caller ? 'attributed-caller' : 'direct-builtin',
    attributionBasis: attribution ? 'sample-path' : 'builtin-only',
    attributionConfidence: attribution?.confidence ?? 'low',
    userCaller: attribution,
    candidateCallers: candidateCallerEvidence,
  };
}

export function selfHotspotUserCaller(
  hotspot: Pick<Hotspot, 'function' | 'file' | 'line' | 'source'> & {
    column?: number;
    totalPct?: number;
    samplePct?: number;
  },
): UserCallerAttribution {
  return {
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    column: hotspot.column,
    ...(hotspot.source ? { source: hotspot.source } : {}),
    stackDistance: 0,
    profilePct: hotspot.totalPct ?? hotspot.samplePct ?? 0,
    supportPct: 100,
    confidence: 'high',
    basis: 'cpu-sample-path',
  };
}

export function pickPrimaryCallerBySource(
  candidateCallers: readonly UserCallerAttribution[],
  cwd: string,
  pattern: RegExp,
): UserCallerAttribution | undefined {
  for (const candidate of candidateCallers) {
    const sourceText = readFrameSourceText(candidate, cwd);
    const anchorLine = candidate.source?.line ?? candidate.line;
    const matchedLine =
      findPatternLineNearAnchor(sourceText, anchorLine, pattern) ??
      findPatternLineInFunctionBlock(sourceText, anchorLine, pattern);
    if (matchedLine === undefined) continue;
    return {
      ...candidate,
      line: matchedLine,
      ...(candidate.source ? { source: { ...candidate.source, line: matchedLine } } : {}),
    };
  }
  return undefined;
}

export function sourceCallPatternForApi(api: string): RegExp {
  const apiPathParts = api.split('.').filter(Boolean).map(escapeRegExp);
  const apiLeafName = apiPathParts.at(-1);
  if (!apiLeafName) return /$a/;
  const dottedApiPattern = apiPathParts.join('\\s*\\.\\s*');
  return new RegExp(`\\b(?:${dottedApiPattern}|${apiLeafName})\\s*\\(`);
}

export function sourcePatternForTerms(terms: readonly string[]): RegExp {
  const escaped = terms.filter(Boolean).map(escapeRegExp);
  if (escaped.length === 0) return /$a/;
  return new RegExp(escaped.join('|'));
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
    if (!matchesHotspotCategory(hotspot, categories)) continue;
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
  caller: UserCallerAttribution | undefined,
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
  caller: UserCallerAttribution | undefined;
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
    confidence: extra.attributionConfidence === 'high' ? 'high' : 'medium',
    proofLevel: 'direct-sample',
    evidence: {
      file: resolveEvidenceField(caller, hotspot, 'file'),
      line: resolveEvidenceField(caller, hotspot, 'line'),
      function: resolveEvidenceField(caller, hotspot, 'function'),
      selfPct,
      ...((caller?.source ?? hotspot.source) ? { source: caller?.source ?? hotspot.source } : {}),
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

export function readFrameSourceText(
  frame: { file?: string; source?: { file: string } } | undefined,
  cwd: string,
): string | undefined {
  if (!frame) return undefined;
  const sourceFileCandidates = [frame.source?.file, frame.file].filter((file): file is string =>
    Boolean(file),
  );
  for (const sourceFile of sourceFileCandidates) {
    if (sourceFile.startsWith('node:') || sourceFile.startsWith('native ')) continue;
    const path = isAbsolute(sourceFile) ? sourceFile : join(cwd, sourceFile);
    if (!existsSync(path)) continue;
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // Source inspection is best-effort; detectors can still use sample evidence.
    }
  }
  return undefined;
}

function findPatternLineNearAnchor(
  sourceText: string | undefined,
  line: number,
  pattern: RegExp,
  radius = 2,
): number | undefined {
  if (!sourceText || line <= 0) return undefined;
  const lines = sourceText.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) return undefined;
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  for (let current = start; current < end; current += 1) {
    if (matchesSourceLine(lines[current] ?? '', pattern)) return current + 1;
  }
  return undefined;
}

function findPatternLineInFunctionBlock(
  sourceText: string | undefined,
  line: number,
  pattern: RegExp,
): number | undefined {
  if (!sourceText || line <= 0) return undefined;
  const lines = sourceText.split(/\r?\n/);
  let depth = 0;
  let enteredBlock = false;
  for (let current = line - 1; current < lines.length; current += 1) {
    const text = lines[current] ?? '';
    if (enteredBlock && matchesSourceLine(text, pattern)) return current + 1;
    for (const char of text) {
      if (char === '{') {
        depth += 1;
        enteredBlock = true;
      } else if (char === '}') {
        depth -= 1;
        if (enteredBlock && depth <= 0) return undefined;
      }
    }
  }
  return undefined;
}

function matchesSourceLine(line: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(line);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
