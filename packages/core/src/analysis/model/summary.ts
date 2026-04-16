import type { FrameCategory, LanternaReport, ReportSummary } from '../../report/types.js';
import type { EnrichedTree } from './hotspots.js';

export function buildSummary(tree: EnrichedTree): ReportSummary {
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
  findings: LanternaReport['findings'],
): ReportSummary['dominantBlockingKind'] {
  if (findings.some((finding) => finding.category === 'sync-crypto')) {
    return 'sync-crypto';
  }
  if (findings.some((finding) => finding.category === 'blocking-io')) {
    return 'blocking-io';
  }
  return null;
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
