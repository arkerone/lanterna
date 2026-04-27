import type {
  CorrelatedHotspot,
  CpuSummary,
  FrameCategory,
  Hotspot,
  LanternaReport,
  SummaryUserHotspot,
} from '../../report/types.js';
import type { EnrichedTree } from './hotspots.js';

const TOP_USER_HOTSPOT_MIN_SELF_PCT = 10;
const TOP_USER_HOTSPOT_MIN_TOTAL_PCT = 20;

export function buildCpuSummary(tree: EnrichedTree): CpuSummary {
  const totals = createFrameCategoryTotals();
  for (const node of tree.nodes.values()) {
    totals[node.category] += node.hitCount;
  }

  const totalSamples = Math.max(1, tree.totalSamples);
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
  const matches = hotspots
    .filter(
      (hotspot) =>
        hotspot.category === 'user' &&
        (hotspot.selfPct >= TOP_USER_HOTSPOT_MIN_SELF_PCT ||
          hotspot.totalPct >= TOP_USER_HOTSPOT_MIN_TOTAL_PCT) &&
        !isExplainedBySpecificFinding(hotspot, findings),
    )
    .sort((left, right) => {
      const totalDelta = right.totalPct - left.totalPct;
      if (totalDelta !== 0) return totalDelta;
      return right.selfPct - left.selfPct;
    });
  const top = matches[0];
  if (!top) return undefined;

  const correlated = correlatedHotspots.find(
    (candidate) =>
      candidate.file === top.file &&
      candidate.line === top.line &&
      candidate.function === top.function,
  );
  const alternatives = matches.slice(1, 3).map((hotspot) => ({
    id: hotspot.id,
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    selfPct: hotspot.selfPct,
    totalPct: hotspot.totalPct,
  }));

  return {
    function: top.function,
    file: top.file,
    line: top.line,
    selfPct: top.selfPct,
    totalPct: top.totalPct,
    eventLoopCorrelation: correlated
      ? { overlapPct: correlated.overlapPct, samplePct: correlated.samplePct }
      : undefined,
    alternativeHotspots: alternatives.length > 0 ? alternatives : undefined,
  };
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
    if (matchesHotspot(finding.evidence, hotspot)) return true;
    const userAttribution = (finding.evidence.extra as { userAttribution?: unknown } | undefined)
      ?.userAttribution;
    return matchesHotspot(userAttribution, hotspot);
  });
}

function matchesHotspot(candidate: unknown, hotspot: Hotspot): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  const value = candidate as { file?: unknown; line?: unknown; function?: unknown };
  return (
    value.file === hotspot.file &&
    value.line === hotspot.line &&
    value.function === hotspot.function
  );
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
