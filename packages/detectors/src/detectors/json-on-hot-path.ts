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
  pickPrimaryCallerBySource,
  readFrameSourceText,
  resolveAttribution,
  selfHotspotUserCaller,
  sourceCallPatternForApi,
} from './shared.js';

export const jsonOnHotPathDetector: KindScopedDetector<'cpu'> = {
  id: 'json-on-hot-path',
  kindIds: ['cpu'],
  order: 20,
  detect({ cpu }): Finding[] {
    const report = cpu.report;
    const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
    const thresholds = DETECTOR_THRESHOLDS.jsonHotPath;
    const cwd = cpu.view.bundle.target.cwd;
    const { categoryTotalPct } = aggregateByPatterns(context.fullHotspots, JSON_FUNCTION_PATTERNS, {
      normalize: stripOptPrefix,
    });
    const familyExceeded = categoryTotalPct >= thresholds.categoryTotalPct;
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      const patternMatch = JSON_FUNCTION_PATTERNS.find((pattern) =>
        pattern.re.test(normalizedFunctionName),
      );
      if (!patternMatch) continue;
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'native') continue;
      if (hotspot.totalPct < thresholds.minTotalPct && !familyExceeded) continue;
      const finding = buildFinding(
        hotspot,
        patternMatch.api,
        categoryTotalPct,
        report,
        context,
        cwd,
      );
      if (seen.has(finding.id)) continue;
      seen.add(finding.id);
      findings.push(finding);
    }
    for (const hotspot of context.fullHotspots) {
      if (hotspot.category !== 'user') continue;
      if (hotspot.totalPct < thresholds.minTotalPct && !familyExceeded) continue;
      if (!hasDominantSelfCost(hotspot, thresholds.minTotalPct)) continue;
      const api = inlinedJsonApi(readFrameSourceText(hotspot, cwd), hotspot.line);
      if (!api) continue;
      const finding = buildFinding(hotspot, api, categoryTotalPct, report, context, cwd);
      if (seen.has(finding.id)) continue;
      seen.add(finding.id);
      findings.push(finding);
    }
    return findings;
  },
};

function hasDominantSelfCost(hotspot: Hotspot, minSelfPct: number): boolean {
  if (hotspot.selfPct < minSelfPct) return false;
  if (hotspot.totalPct <= 0) return true;
  return hotspot.selfPct / hotspot.totalPct >= 0.5;
}

function inlinedJsonApi(sourceText: string | undefined, line: number): string | undefined {
  const sourceWindow = sourceTextAroundLine(sourceText, line);
  if (!sourceWindow) return undefined;
  if (/\bJSON\.stringify\s*\(/.test(sourceWindow)) return 'JSON.stringify';
  if (/\bJSON\.parse\s*\(/.test(sourceWindow)) return 'JSON.parse';
  return undefined;
}

function sourceTextAroundLine(
  sourceText: string | undefined,
  line: number,
  radius = 3,
): string | undefined {
  if (!sourceText || line <= 0) return undefined;
  const lines = sourceText.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) return undefined;
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join('\n');
}

function buildFinding(
  hotspot: Hotspot,
  api: string,
  categoryTotalPct: number,
  report: { eventLoop: EventLoopReport },
  context: CpuHotspotContext,
  cwd: string,
): BuiltinFinding<'json-on-hot-path'> {
  const { attribution, caller, candidateCallers } = resolveAttribution(hotspot, context);
  const sourceCaller = pickPrimaryCallerBySource(
    candidateCallers,
    cwd,
    sourceCallPatternForApi(api),
  );
  const evidenceAttribution =
    sourceCaller ??
    attribution ??
    (hotspot.category === 'user' ? selfHotspotUserCaller(hotspot) : undefined);
  const highConfidenceCaller =
    evidenceAttribution?.confidence === 'high' ? evidenceAttribution : undefined;
  const evidenceExtra: JsonHotPathEvidenceExtra = {
    callee: hotspot.category === 'user' ? api : hotspot.function,
    calleeTotalPct: hotspot.totalPct,
    ...buildAttributionEvidence(evidenceAttribution, highConfidenceCaller, candidateCallers),
    eventLoopCorrelation: findStallCorrelation(sourceCaller ?? caller ?? attribution, report),
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
      caller:
        sourceCaller ?? caller ?? (hotspot.category === 'user' ? evidenceAttribution : undefined),
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
