import { DETECTOR_THRESHOLDS } from '../../config.js';
import { defineAttributedHotspotDetector } from '../shared/attributed-finding.js';
import { sourcePatternForTerms, toAlternativeHotspotEvidence } from '../shared/attribution.js';

const thresholds = DETECTOR_THRESHOLDS.nodeModulesHotspot;

interface NodeModulesMatch {
  readonly package: string;
}

export const nodeModulesHotspotDetector = defineAttributedHotspotDetector<
  'node-modules-hotspot',
  NodeModulesMatch
>({
  id: 'node-modules-hotspot',
  order: 40,
  category: 'node-modules-hotspot',
  match(hotspot) {
    if (hotspot.category !== 'node_modules') return undefined;
    if (hotspot.package === undefined) return undefined;
    if (!(hotspot.selfPct >= thresholds.minSelfPct || hotspot.totalPct >= thresholds.minTotalPct)) {
      return undefined;
    }
    return { package: hotspot.package };
  },
  select: { top: 1, alternatives: 2 },
  severity: (_match, hotspot) =>
    hotspot.totalPct >= thresholds.criticalTotalPct ? 'critical' : 'warning',
  selfPct: (_match, hotspot) => hotspot.totalPct,
  sourcePattern: (_match, hotspot) =>
    sourcePatternForTerms([hotspot.package ?? '', hotspot.function]),
  describe: (_match, hotspot) => ({
    id: `node-modules-hotspot:${hotspot.package ?? hotspot.function}`,
    title: `Dependency hotspot on hot path (${hotspot.package ?? hotspot.function})`,
    why: `A dependency frame from \`${hotspot.package ?? hotspot.file}\` is dominating the CPU profile. That usually means the main request path is paying for expensive library work rather than your own code directly.`,
    suggestion: `Inspect how often this dependency is called and whether you can reduce input size, cache results, switch to a cheaper code path, or replace the library for this workload. If the work is inherently heavy, move it off the main thread.`,
    references: ['https://nodejs.org/en/docs/guides/dont-block-the-event-loop'],
  }),
  measurements: (_match, hotspot) => ({
    observed: { selfPct: hotspot.selfPct, totalPct: hotspot.totalPct },
    thresholds: {
      minSelfPct: thresholds.minSelfPct,
      minTotalPct: thresholds.minTotalPct,
      criticalTotalPct: thresholds.criticalTotalPct,
    },
  }),
  extra: (_match, hotspot, parts) => ({
    package: hotspot.package,
    callee: hotspot.function,
    calleeFile: hotspot.file,
    calleeLine: hotspot.line,
    calleeTotalPct: hotspot.totalPct,
    ...parts.attributionEvidence,
    eventLoopCorrelation: parts.eventLoopCorrelation,
    alternativeHotspots: parts.alternatives.map(toAlternativeHotspotEvidence),
  }),
});
