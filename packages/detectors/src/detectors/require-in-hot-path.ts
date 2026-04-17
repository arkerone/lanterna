import type {
  BuiltinFinding,
  Finding,
  Hotspot,
  RequireInHotPathEvidenceExtra,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, REQUIRE_PATTERNS } from '../config.js';
import { buildAttributedFinding, buildAttributionEvidence, resolveAttribution } from './shared.js';
import type { Detector, FindingContext } from './types.js';

export const requireInHotPathDetector: Detector = {
  id: 'require-in-hot-path',
  order: 30,
  detect(_report, context): Finding[] {
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
  context: FindingContext,
): BuiltinFinding<'require-in-hot-path'> {
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: RequireInHotPathEvidenceExtra = {
    callee: hotspot.function,
    ...buildAttributionEvidence(attribution, caller),
  };
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: `require-in-hot-path`,
      severity:
        hotspot.selfPct > DETECTOR_THRESHOLDS.requireInHotPath.warningSelfPct ? 'warning' : 'info',
      category: 'require-in-hot-path',
      title: 'Module loading on hot path',
      hotspot,
      caller,
      selfPct: hotspot.selfPct,
      extra: evidenceExtra,
      why: `\`${hotspot.function}\` is being called during request handling. Module resolution and graph loading are expensive and normally only happen once at startup; hitting them per request implies a lazy require/import inside a hot function.`,
      suggestion: `Hoist the \`require(...)\` / \`await import(...)\` to module top-level (or to an init hook called once at boot). If you truly need lazy loading, memoise the result yourself.`,
      references: ['https://nodejs.org/api/modules.html#modulerequireid'],
    }),
  );
}
