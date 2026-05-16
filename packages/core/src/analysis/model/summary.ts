import type {
  CorrelatedHotspot,
  CpuSummary,
  FrameCategory,
  Hotspot,
  LanternaReport,
  SummaryUserHotspot,
} from '../../report/types.js';
import { isNoiseCategory, shouldKeepNoiseFrames } from '../noise-filters.js';
import type { EnrichedTree } from './hotspots.js';

const TOP_USER_HOTSPOT_MIN_SELF_PCT = 10;
const TOP_USER_HOTSPOT_MIN_TOTAL_PCT = 20;

export function buildCpuSummary(tree: EnrichedTree): CpuSummary {
  const totals = createFrameCategoryTotals();
  for (const node of tree.nodes.values()) {
    totals[node.category] += node.hitCount;
  }

  // Profiler instrumentation samples shouldn't count toward the
  // application's CPU budget — exclude them so ratios describe the profiled
  // app, not the profiler. LANTERNA_DEBUG_SELF=1 keeps the raw counts.
  const noiseSamples = shouldKeepNoiseFrames() ? 0 : sumNoiseSamples(totals);
  const totalSamples = Math.max(1, tree.totalSamples - noiseSamples);
  const idleSamples = totals.idle + totals.program;
  const onCpuSamples = totalSamples - idleSamples;
  const onCpuDenominator = Math.max(1, onCpuSamples);

  return {
    totalCpuMs: onCpuSamples * tree.sampleIntervalMs,
    onCpuRatio: onCpuSamples / totalSamples,
    userCodeRatio: totals.user / onCpuDenominator,
    nodeModulesRatio: totals.node_modules / onCpuDenominator,
    builtinRatio: totals['node:builtin'] / onCpuDenominator,
    nativeRatio: totals.native / onCpuDenominator,
    gcRatio: totals.gc / onCpuDenominator,
    idleRatio: idleSamples / totalSamples,
    topCategory: findTopOnCpuCategory(totals),
    dominantBlockingKind: null,
  };
}

export function deriveDominantBlockingKind(
  findings: readonly LanternaReport['findings'][number][],
): CpuSummary['dominantBlockingKind'] {
  if (findings.some((finding) => finding.category === 'sync-crypto')) {
    return 'sync-crypto';
  }
  if (findings.some((finding) => finding.category === 'blocking-io')) {
    return 'blocking-io';
  }
  return null;
}

export function deriveTopUserHotspot(
  hotspots: readonly Hotspot[],
  correlatedHotspots: readonly CorrelatedHotspot[] = [],
  findings: LanternaReport['findings'] = [],
): SummaryUserHotspot | undefined {
  const candidateHotspots = dedupeHotspots([
    ...hotspots,
    ...hotspotsFromCandidateCallers(findings),
  ]);
  const eligibleUserHotspots = candidateHotspots
    .filter(
      (hotspot) =>
        hotspot.category === 'user' &&
        (hotspot.selfPct >= TOP_USER_HOTSPOT_MIN_SELF_PCT ||
          hotspot.totalPct >= TOP_USER_HOTSPOT_MIN_TOTAL_PCT),
    )
    .map((hotspot) => ({
      hotspot,
      correlated: findCorrelatedHotspot(hotspot, correlatedHotspots),
      explained: isExplainedBySpecificFinding(hotspot, findings),
    }));
  const unexplainedUserHotspots = eligibleUserHotspots.filter((candidate) => !candidate.explained);
  const userHotspotsToRank =
    unexplainedUserHotspots.length > 0 ? unexplainedUserHotspots : eligibleUserHotspots;
  const rankedUserHotspots = [...userHotspotsToRank].sort((left, right) =>
    compareTopHotspotCandidates(left, right),
  );
  const primaryCandidate = rankedUserHotspots[0];
  const primaryHotspot = primaryCandidate?.hotspot;
  if (!primaryHotspot) return undefined;

  const primaryCorrelation = primaryCandidate.correlated;
  const alternativeHotspots = rankedUserHotspots.slice(1, 3).map(({ hotspot }) => {
    const alternative: SummaryUserHotspot['alternativeHotspots'] extends (infer T)[] | undefined
      ? T
      : never = {
      id: hotspot.id,
      function: hotspot.function,
      file: hotspot.file,
      line: hotspot.line,
      selfPct: hotspot.selfPct,
      totalPct: hotspot.totalPct,
    };
    if (hotspot.source) alternative.source = hotspot.source;
    return alternative;
  });

  const summary: SummaryUserHotspot = {
    function: primaryHotspot.function,
    file: primaryHotspot.file,
    line: primaryHotspot.line,
    selfPct: primaryHotspot.selfPct,
    totalPct: primaryHotspot.totalPct,
    eventLoopCorrelation: primaryCorrelation
      ? { overlapPct: primaryCorrelation.overlapPct, samplePct: primaryCorrelation.samplePct }
      : undefined,
    alternativeHotspots: alternativeHotspots.length > 0 ? alternativeHotspots : undefined,
  };
  if (primaryHotspot.source) summary.source = primaryHotspot.source;
  return summary;
}

export function deriveTopCpuCulprit(
  hotspots: readonly Hotspot[],
  correlatedHotspots: readonly CorrelatedHotspot[] = [],
): SummaryUserHotspot | undefined {
  const eligibleCpuCulprits = hotspots
    .filter(
      (hotspot) => hotspot.category === 'user' && hotspot.selfPct >= TOP_USER_HOTSPOT_MIN_SELF_PCT,
    )
    .map((hotspot) => ({
      hotspot,
      correlated: findCorrelatedHotspot(hotspot, correlatedHotspots),
    }));
  const rankedCpuCulprits = [...eligibleCpuCulprits].sort(compareCpuCulpritCandidates);
  const primaryCandidate = rankedCpuCulprits[0];
  const primaryHotspot = primaryCandidate?.hotspot;
  if (!primaryHotspot) return undefined;

  return toSummaryUserHotspot(
    primaryHotspot,
    primaryCandidate.correlated,
    rankedCpuCulprits.slice(1, 3).map(({ hotspot }) => hotspot),
  );
}

function compareTopHotspotCandidates(
  left: { hotspot: Hotspot; correlated?: CorrelatedHotspot },
  right: { hotspot: Hotspot; correlated?: CorrelatedHotspot },
): number {
  const correlationDelta = correlationScore(right.correlated) - correlationScore(left.correlated);
  if (correlationDelta !== 0) return correlationDelta;
  const totalDelta = right.hotspot.totalPct - left.hotspot.totalPct;
  if (totalDelta !== 0) return totalDelta;
  return right.hotspot.selfPct - left.hotspot.selfPct;
}

function compareCpuCulpritCandidates(
  left: { hotspot: Hotspot; correlated?: CorrelatedHotspot },
  right: { hotspot: Hotspot; correlated?: CorrelatedHotspot },
): number {
  const selfDelta = right.hotspot.selfPct - left.hotspot.selfPct;
  if (selfDelta !== 0) return selfDelta;
  const correlationDelta = correlationScore(right.correlated) - correlationScore(left.correlated);
  if (correlationDelta !== 0) return correlationDelta;
  return right.hotspot.totalPct - left.hotspot.totalPct;
}

function correlationScore(correlated: CorrelatedHotspot | undefined): number {
  if (!correlated) return 0;
  const confidenceWeight =
    correlated.confidence === 'high' ? 3 : correlated.confidence === 'medium' ? 2 : 1;
  return confidenceWeight * 1000 + correlated.overlapPct;
}

function findCorrelatedHotspot(
  hotspot: Hotspot,
  correlatedHotspots: readonly CorrelatedHotspot[],
): CorrelatedHotspot | undefined {
  return correlatedHotspots.find(
    (candidate) =>
      candidate.file === hotspot.file &&
      candidate.line === hotspot.line &&
      candidate.function === hotspot.function,
  );
}

function toSummaryUserHotspot(
  hotspot: Hotspot,
  correlated: CorrelatedHotspot | undefined,
  alternativeHotspots: readonly Hotspot[],
): SummaryUserHotspot {
  const alternatives = alternativeHotspots.map((alternativeHotspot) => {
    const alternative: SummaryUserHotspot['alternativeHotspots'] extends (infer T)[] | undefined
      ? T
      : never = {
      id: alternativeHotspot.id,
      function: alternativeHotspot.function,
      file: alternativeHotspot.file,
      line: alternativeHotspot.line,
      selfPct: alternativeHotspot.selfPct,
      totalPct: alternativeHotspot.totalPct,
    };
    if (alternativeHotspot.source) alternative.source = alternativeHotspot.source;
    return alternative;
  });
  const summary: SummaryUserHotspot = {
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    selfPct: hotspot.selfPct,
    totalPct: hotspot.totalPct,
    eventLoopCorrelation: correlated
      ? { overlapPct: correlated.overlapPct, samplePct: correlated.samplePct }
      : undefined,
    alternativeHotspots: alternatives.length > 0 ? alternatives : undefined,
  };
  if (hotspot.source) summary.source = hotspot.source;
  return summary;
}

function dedupeHotspots(hotspots: Hotspot[]): Hotspot[] {
  const hotspotById = new Map<string, Hotspot>();
  for (const hotspot of hotspots) {
    if (!hotspotById.has(hotspot.id)) hotspotById.set(hotspot.id, hotspot);
  }
  return Array.from(hotspotById.values());
}

function hotspotsFromCandidateCallers(findings: LanternaReport['findings']): Hotspot[] {
  const hotspotById = new Map<string, Hotspot>();
  for (const finding of findings) {
    if (!SPECIFIC_FINDING_CATEGORIES.has(finding.category)) continue;
    const extra = finding.evidence.extra as { candidateCallers?: unknown } | undefined;
    if (!Array.isArray(extra?.candidateCallers)) continue;
    for (const candidate of extra.candidateCallers) {
      if (!isUserCallerCandidate(candidate)) continue;
      const id = `${candidate.file}:${candidate.line}:${candidate.function}`;
      if (hotspotById.has(id)) continue;
      hotspotById.set(id, {
        id,
        function: candidate.function,
        file: candidate.file,
        line: candidate.line,
        column: candidate.column ?? 1,
        category: 'user',
        selfMs: 0,
        selfPct: 0,
        totalMs: 0,
        totalPct: candidate.profilePct,
        callers: [],
        callees: [],
        optimizationState: 'unknown',
        source: candidate.source,
      });
    }
  }
  return Array.from(hotspotById.values());
}

function isUserCallerCandidate(candidate: unknown): candidate is {
  function: string;
  file: string;
  line: number;
  column?: number;
  stackDistance?: number;
  profilePct: number;
  source?: SummaryUserHotspot['source'];
} {
  if (!candidate || typeof candidate !== 'object') return false;
  const candidateValue = candidate as {
    function?: unknown;
    file?: unknown;
    line?: unknown;
    profilePct?: unknown;
  };
  return (
    typeof candidateValue.function === 'string' &&
    typeof candidateValue.file === 'string' &&
    typeof candidateValue.line === 'number' &&
    typeof candidateValue.profilePct === 'number'
  );
}

const SPECIFIC_FINDING_CATEGORIES = new Set([
  'blocking-io',
  'sync-crypto',
  'json-on-hot-path',
  'node-modules-hotspot',
  'require-in-hot-path',
]);

function isExplainedBySpecificFinding(
  hotspot: Hotspot,
  findings: LanternaReport['findings'],
): boolean {
  return findings.some((finding) => {
    if (!SPECIFIC_FINDING_CATEGORIES.has(finding.category)) return false;
    if (matchesHotspotFrame(finding.evidence, hotspot)) return true;
    const extra = finding.evidence.extra as
      | { userCaller?: unknown; candidateCallers?: unknown }
      | undefined;
    const userCaller = extra?.userCaller;
    const candidateCallers = extra?.candidateCallers;
    if (matchesHotspotFrame(userCaller, hotspot)) return true;
    if (Array.isArray(candidateCallers)) {
      return candidateCallers.some((candidate) => matchesHotspotFrame(candidate, hotspot));
    }
    return false;
  });
}

function matchesHotspotFrame(frame: unknown, hotspot: Hotspot): boolean {
  if (!frame || typeof frame !== 'object') return false;
  const frameValue = frame as { file?: unknown; line?: unknown; function?: unknown };
  return (
    frameValue.file === hotspot.file &&
    frameValue.line === hotspot.line &&
    frameValue.function === hotspot.function
  );
}

function sumNoiseSamples(totals: Record<FrameCategory, number>): number {
  let sum = 0;
  for (const [category, count] of Object.entries(totals) as [FrameCategory, number][]) {
    if (isNoiseCategory(category)) sum += count;
  }
  return sum;
}

function createFrameCategoryTotals(): Record<FrameCategory, number> {
  return {
    user: 0,
    node_modules: 0,
    'node:builtin': 0,
    native: 0,
    gc: 0,
    program: 0,
    idle: 0,
    lanterna: 0,
    unknown: 0,
  };
}

function findTopOnCpuCategory(totals: Record<FrameCategory, number>): FrameCategory {
  const onCpuCategories: FrameCategory[] = ['user', 'node_modules', 'node:builtin', 'native', 'gc'];
  let topCategory: FrameCategory = 'user';
  let topValue = -1;

  for (const category of onCpuCategories) {
    if (totals[category] > topValue) {
      topValue = totals[category];
      topCategory = category;
    }
  }

  return topCategory;
}
