import type { BuiltinFinding, Finding, Hotspot, JsonHotPathEvidenceExtra, LanternaReport } from '../../report/types.js';
import { defineBuiltinFinding } from '../../report/types.js';
import type { Detector, FindingContext } from './types.js';
import {
  buildAttributionEvidence,
  buildAttributedFinding,
  findStallCorrelation,
  resolveAttribution,
} from './shared.js';
import { stripOptPrefix } from '../../shared/frame.js';
import { DETECTOR_THRESHOLDS } from '../../shared/config.js';

const JSON_PATTERNS: Array<{ re: RegExp; api: string }> = [
  { re: /(^|\.)JSON\.parse$/, api: 'JSON.parse' },
  { re: /(^|\.)JSON\.stringify$/, api: 'JSON.stringify' },
];

export const jsonOnHotPathDetector: Detector = {
  id: 'json-on-hot-path',
  order: 20,
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.jsonHotPath;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      const patternMatch = JSON_PATTERNS.find((pattern) => pattern.re.test(normalizedFunctionName));
      if (!patternMatch) continue;
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'native') continue;
      if (hotspot.totalPct < thresholds.minTotalPct) continue;
      findings.push(buildFinding(hotspot, patternMatch.api, report, context));
    }
    return findings;
  },
};

function buildFinding(
  hotspot: Hotspot,
  api: string,
  report: LanternaReport,
  context: FindingContext,
): BuiltinFinding<'json-on-hot-path'> {
  const { attribution, caller } = resolveAttribution(hotspot, context);
  const evidenceExtra: JsonHotPathEvidenceExtra = {
    callee: hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(attribution, caller),
    eventLoopCorrelation: findStallCorrelation(caller, report),
  };
  return defineBuiltinFinding(buildAttributedFinding({
    id: `json-on-hot-path:${api}`,
    category: 'json-on-hot-path',
    severity: hotspot.totalPct >= DETECTOR_THRESHOLDS.jsonHotPath.criticalPct ? 'critical' : 'warning',
    title: `${api} on hot path`,
    hotspot,
    caller,
    selfPct: hotspot.totalPct,
    extra: evidenceExtra,
    why: `\`${api}\` is consuming a meaningful share of on-CPU time on the main thread. Repeated JSON parse/stringify work is both CPU-heavy and allocation-heavy, so it often amplifies event-loop latency and GC pressure.`,
    suggestion: `Avoid repeated \`${api}\` work per request. Parse once at the edge, serialize once at the boundary, cache stable payloads, and prefer streaming JSON for large bodies instead of building huge objects/strings in memory.`,
    references: [
      'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
      'https://nodejs.org/api/stream.html',
    ],
  }));
}
