import type {
  BuiltinFinding,
  Finding,
  Hotspot,
  KindScopedDetector,
  RequireInHotPathEvidenceExtra,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, REQUIRE_PATTERNS } from '../config.js';
import {
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  resolveAttribution,
} from './shared.js';

export const requireInHotPathDetector: KindScopedDetector<'cpu'> = {
  id: 'require-in-hot-path',
  kindIds: ['cpu'],
  order: 30,
  detect({ cpu }): Finding[] {
    const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
    const thresholds = DETECTOR_THRESHOLDS.requireInHotPath;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      if (!REQUIRE_PATTERNS.some((pattern) => pattern.test(normalizedFunctionName))) continue;
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'node_modules') continue;
      if (hotspot.selfPct < thresholds.minSelfPct && hotspot.totalPct < thresholds.minTotalPct)
        continue;
      findings.push(buildFinding(hotspot, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  context: CpuHotspotContext,
): BuiltinFinding<'require-in-hot-path'> {
  const { attribution, caller, candidateCallers } = resolveAttribution(hotspot, context);
  const evidenceExtra: RequireInHotPathEvidenceExtra = {
    callee: hotspot.function,
    ...buildAttributionEvidence(attribution, caller, candidateCallers),
  };
  const thresholds = DETECTOR_THRESHOLDS.requireInHotPath;
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: `require-in-hot-path`,
      severity: hotspot.selfPct > thresholds.warningSelfPct ? 'warning' : 'info',
      category: 'require-in-hot-path',
      title: 'Module loading on hot path',
      hotspot,
      caller,
      selfPct: hotspot.selfPct,
      extra: evidenceExtra,
      measurements: {
        observed: { selfPct: hotspot.selfPct, totalPct: hotspot.totalPct },
        thresholds: {
          minSelfPct: thresholds.minSelfPct,
          minTotalPct: thresholds.minTotalPct,
          warningSelfPct: thresholds.warningSelfPct,
        },
      },
      remediation: {
        kind: 'lazy-import-hoist',
        notes:
          'Hoist the require()/await import() to module top-level or an init hook called once at boot. If lazy loading is required, memoise the loaded module yourself so subsequent calls are cheap.',
      },
      why: `\`${hotspot.function}\` is being called during request handling. Module resolution and graph loading are expensive and normally only happen once at startup; hitting them per request implies a lazy require/import inside a hot function.`,
      suggestion: `Hoist the \`require(...)\` / \`await import(...)\` to module top-level (or to an init hook called once at boot). If you truly need lazy loading, memoise the result yourself.`,
      references: ['https://nodejs.org/api/modules.html#modulerequireid'],
    }),
  );
}
