import type {
  BuiltinFinding,
  EventLoopReport,
  Finding,
  Hotspot,
  JsonHotPathEvidenceExtra,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS, JSON_FUNCTION_PATTERNS } from '../config.js';
import {
  aggregateByPatterns,
  buildAttributedFinding,
  buildAttributionEvidence,
  type CpuHotspotContext,
  findStallCorrelation,
  resolveAttribution,
} from './shared.js';

export const jsonOnHotPathDetector: KindScopedDetector<'cpu'> = {
  id: 'json-on-hot-path',
  kindIds: ['cpu'],
  order: 20,
  detect({ cpu }): Finding[] {
    const report = cpu.report;
    const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
    const thresholds = DETECTOR_THRESHOLDS.jsonHotPath;
    const { categoryTotalPct } = aggregateByPatterns(context.fullHotspots, JSON_FUNCTION_PATTERNS, {
      normalize: stripOptPrefix,
    });
    const familyExceeded = categoryTotalPct >= thresholds.categoryTotalPct;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      const patternMatch = JSON_FUNCTION_PATTERNS.find((pattern) =>
        pattern.re.test(normalizedFunctionName),
      );
      if (!patternMatch) continue;
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'native') continue;
      if (hotspot.totalPct < thresholds.minTotalPct && !familyExceeded) continue;
      findings.push(buildFinding(hotspot, patternMatch.api, categoryTotalPct, report, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  api: string,
  categoryTotalPct: number,
  report: { eventLoop: EventLoopReport },
  context: CpuHotspotContext,
): BuiltinFinding<'json-on-hot-path'> {
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: JsonHotPathEvidenceExtra = {
    callee: hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
    categoryTotalPct: categoryTotalPct > 0 ? categoryTotalPct : undefined,
  };
  const thresholds = DETECTOR_THRESHOLDS.jsonHotPath;
  return defineBuiltinFinding(
    buildAttributedFinding({
      id: `json-on-hot-path:${api}`,
      category: 'json-on-hot-path',
      severity: hotspot.totalPct >= thresholds.criticalPct ? 'critical' : 'warning',
      title: `${api} on hot path`,
      hotspot,
      caller,
      selfPct: hotspot.totalPct,
      extra: evidenceExtra,
      measurements: {
        observed: {
          selfPct: hotspot.selfPct,
          totalPct: hotspot.totalPct,
          categoryTotalPct,
        },
        thresholds: {
          minTotalPct: thresholds.minTotalPct,
          criticalPct: thresholds.criticalPct,
          categoryTotalPct: thresholds.categoryTotalPct,
        },
      },
      why: `\`${api}\` is consuming a meaningful share of on-CPU time on the main thread. Repeated JSON parse/stringify work is both CPU-heavy and allocation-heavy, so it often amplifies event-loop latency and GC pressure.`,
      suggestion: `Avoid repeated \`${api}\` work per request. Parse once at the edge, serialize once at the boundary, cache stable payloads, and prefer streaming JSON for large bodies instead of building huge objects/strings in memory.`,
      references: [
        'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
        'https://nodejs.org/api/stream.html',
      ],
    }),
  );
}
