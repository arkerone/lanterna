import { stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, REQUIRE_PATTERNS } from '../../config.js';
import { defineAttributedHotspotDetector } from '../shared/attributed-finding.js';

const thresholds = DETECTOR_THRESHOLDS.requireInHotPath;

interface RequireMatch {
  readonly callee: string;
}

export const requireInHotPathDetector = defineAttributedHotspotDetector<
  'require-in-hot-path',
  RequireMatch
>({
  id: 'require-in-hot-path',
  order: 30,
  category: 'require-in-hot-path',
  match(hotspot) {
    const normalizedFunctionName = stripOptPrefix(hotspot.function);
    if (!REQUIRE_PATTERNS.some((pattern) => pattern.test(normalizedFunctionName))) return undefined;
    if (hotspot.category !== 'node:builtin' && hotspot.category !== 'node_modules')
      return undefined;
    if (hotspot.selfPct < thresholds.minSelfPct && hotspot.totalPct < thresholds.minTotalPct) {
      return undefined;
    }
    return { callee: hotspot.function };
  },
  severity: (_match, hotspot) => (hotspot.selfPct > thresholds.warningSelfPct ? 'warning' : 'info'),
  selfPct: (_match, hotspot) => hotspot.selfPct,
  sourcePattern: () => /\b(?:require|import)\s*\(/,
  describe: (_match, hotspot) => ({
    id: 'require-in-hot-path',
    title: 'Module loading on hot path',
    why: `\`${hotspot.function}\` is being called during request handling. Module resolution and graph loading are expensive and normally only happen once at startup; hitting them per request implies a lazy require/import inside a hot function.`,
    suggestion: `Hoist the \`require(...)\` / \`await import(...)\` to module top-level (or to an init hook called once at boot). If you truly need lazy loading, memoise the result yourself.`,
    references: ['https://nodejs.org/api/modules.html#modulerequireid'],
    remediation: {
      kind: 'lazy-import-hoist',
      notes:
        'Hoist the require()/await import() to module top-level or an init hook called once at boot. If lazy loading is required, memoise the loaded module yourself so subsequent calls are cheap.',
    },
  }),
  measurements: (_match, hotspot) => ({
    observed: { selfPct: hotspot.selfPct, totalPct: hotspot.totalPct },
    thresholds: {
      minSelfPct: thresholds.minSelfPct,
      minTotalPct: thresholds.minTotalPct,
      warningSelfPct: thresholds.warningSelfPct,
    },
  }),
  extra: (match, _hotspot, parts) => ({
    callee: match.callee,
    ...parts.attributionEvidence,
  }),
});
