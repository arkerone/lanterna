import type {
  BuiltinFinding,
  EventLoopReport,
  Finding,
  Hotspot,
  NodeModulesHotspotEvidenceExtra,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import {
  buildAttributedFinding,
  buildAttributionEvidence,
  findStallCorrelation,
  resolveAttribution,
  toAlternativeHotspotEvidence,
} from './shared.js';
import type { Detector, FindingContext } from './types.js';

export const nodeModulesHotspotDetector: Detector = {
  id: 'node-modules-hotspot',
  order: 40,
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.nodeModulesHotspot;
    const matches = context.fullHotspots
      .filter(
        (candidate) =>
          candidate.category === 'node_modules' &&
          candidate.package !== undefined &&
          (candidate.selfPct >= thresholds.minSelfPct ||
            candidate.totalPct >= thresholds.minTotalPct),
      )
      .sort((left, right) => {
        const totalDelta = right.totalPct - left.totalPct;
        if (totalDelta !== 0) return totalDelta;
        return right.selfPct - left.selfPct;
      });
    const hotspot = matches[0];
    if (!hotspot) return [];
    return [buildFinding(hotspot, matches.slice(1, 3), report, context)];
  },
};

function buildFinding(
  hotspot: Hotspot,
  alternatives: Hotspot[],
  report: { eventLoop: EventLoopReport },
  context: FindingContext,
): BuiltinFinding<'node-modules-hotspot'> {
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: NodeModulesHotspotEvidenceExtra = {
    package: hotspot.package,
    callee: hotspot.function,
    calleeFile: hotspot.file,
    calleeLine: hotspot.line,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
    alternativeHotspots: alternatives.map(toAlternativeHotspotEvidence),
  };
  const thresholds = DETECTOR_THRESHOLDS.nodeModulesHotspot;
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: `node-modules-hotspot:${hotspot.package ?? hotspot.function}`,
      category: 'node-modules-hotspot',
      severity: hotspot.totalPct >= thresholds.criticalTotalPct ? 'critical' : 'warning',
      title: `Dependency hotspot on hot path (${hotspot.package ?? hotspot.function})`,
      hotspot,
      caller,
      selfPct: hotspot.totalPct,
      extra: evidenceExtra,
      measurements: {
        observed: { selfPct: hotspot.selfPct, totalPct: hotspot.totalPct },
        thresholds: {
          minSelfPct: thresholds.minSelfPct,
          minTotalPct: thresholds.minTotalPct,
          criticalTotalPct: thresholds.criticalTotalPct,
        },
      },
      why: `A dependency frame from \`${hotspot.package ?? hotspot.file}\` is dominating the CPU profile. That usually means the main request path is paying for expensive library work rather than your own code directly.`,
      suggestion: `Inspect how often this dependency is called and whether you can reduce input size, cache results, switch to a cheaper code path, or replace the library for this workload. If the work is inherently heavy, move it off the main thread.`,
      references: ['https://nodejs.org/en/docs/guides/dont-block-the-event-loop'],
    }),
  );
}
