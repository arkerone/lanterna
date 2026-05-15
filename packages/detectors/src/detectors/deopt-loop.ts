import type {
  BuiltinFinding,
  DeoptEntry,
  DeoptLoopEvidenceExtra,
  Finding,
  Hotspot,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import type { CpuHotspotContext } from './shared.js';

export const deoptLoopDetector: KindScopedDetector<'cpu'> = {
  id: 'deopt-loop',
  kindIds: ['cpu'],
  detect({ cpu }, shared): Finding[] {
    const cpuMeta = shared.meta.kinds.cpu as { deep?: boolean } | undefined;
    if (!cpuMeta?.deep) return [];
    const report = cpu.report;
    const context: CpuHotspotContext = cpu.view.hotspotAnalysis;
    const thresholds = DETECTOR_THRESHOLDS.deoptLoop;
    const findings: Finding[] = [];
    for (const deopt of aggregateDeopts(report.deopts, context)) {
      if (deopt.count < thresholds.minCount) continue;
      const matchingHotspot = findHotDeoptHotspot(deopt.function, deopt.file, deopt.line, context);
      if (!matchingHotspot) continue;
      const evidenceExtra: DeoptLoopEvidenceExtra = {
        proofLevel: 'deopt-trace-only',
        reason: deopt.reason,
        bailoutType: deopt.bailoutType,
        count: deopt.count,
        hotspotTotalPct: matchingHotspot.totalPct,
      };
      const finding: BuiltinFinding<'deopt-loop'> = defineBuiltinFinding({
        id: `deopt-loop:${deopt.function}`,
        profileKind: 'cpu',
        severity: deopt.count >= thresholds.criticalCount ? 'critical' : 'warning',
        category: 'deopt-loop',
        title: `Repeated deoptimisation of ${deopt.function} (${deopt.count}×)`,
        confidence: 'medium',
        proofLevel: 'trace-only',
        evidence: {
          file: deopt.file || matchingHotspot.file,
          line: deopt.line || matchingHotspot.line,
          function: deopt.function,
          selfPct: 0,
          ...(matchingHotspot.source ? { source: matchingHotspot.source } : {}),
          extra: evidenceExtra,
        },
        measurements: {
          observed: { count: deopt.count, hotspotTotalPct: matchingHotspot.totalPct },
          thresholds: {
            minCount: thresholds.minCount,
            criticalCount: thresholds.criticalCount,
          },
        },
        why: `${deopt.function} was deoptimised ${deopt.count} times. ${deopt.explanation}`,
        suggestion: `Stabilise the types and shapes passed to \`${deopt.function}\`. Keep hidden classes consistent (initialise all properties in the constructor in the same order), avoid mixing number/string args, and don't mutate the function's arguments shape across calls.`,
        references: ['https://v8.dev/blog/hidden-classes', 'https://v8.dev/blog/elements-kinds'],
      });
      findings.push(finding);
    }
    return findings;
  },
};

function aggregateDeopts(deopts: readonly DeoptEntry[], context: CpuHotspotContext): DeoptEntry[] {
  const grouped = new Map<string, DeoptEntry>();
  const unknownFallbackHotspot = inferUnknownDeoptHotspot(deopts, context);
  for (const deopt of deopts) {
    const enriched = enrichDeoptWithCpuFrame(deopt, context, unknownFallbackHotspot);
    const key =
      enriched.file && enriched.line > 0
        ? `${enriched.function}:${enriched.file}:${enriched.line}`
        : enriched.function;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...enriched });
      continue;
    }
    existing.count += enriched.count;
    existing.reason = mergeLabel(existing.reason, enriched.reason);
    existing.bailoutType = mergeLabel(existing.bailoutType, enriched.bailoutType);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

function mergeLabel(left: string, right: string): string {
  if (left === right) return left;
  const parts = new Set(
    [...left.split(';'), ...right.split(';')].map((part) => part.trim()).filter(Boolean),
  );
  return Array.from(parts).join('; ');
}

function findHotDeoptHotspot(
  functionName: string,
  file: string,
  line: number,
  context: CpuHotspotContext,
): Hotspot | undefined {
  if (!file || line <= 0) {
    const matches = context.fullHotspots.filter(
      (hotspot) =>
        hotspot.function === functionName && hotspot.category === 'user' && hotspot.totalPct > 1,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  return context.fullHotspots.find(
    (hotspot) =>
      hotspot.function === functionName &&
      matchesDeoptFile(hotspot.file, file) &&
      Math.abs(hotspot.line - line) <= 1 &&
      hotspot.totalPct > 1,
  );
}

function inferUnknownDeoptHotspot(
  deopts: readonly DeoptEntry[],
  context: CpuHotspotContext,
): Hotspot | undefined {
  if (!deopts.some((deopt) => deopt.function === '<unknown>' && (!deopt.file || deopt.line <= 0))) {
    return undefined;
  }
  const candidates = new Map<string, Hotspot>();
  for (const deopt of deopts) {
    if (deopt.function === '<unknown>') continue;
    const hotspot = findUniqueUserHotspotByFunction(deopt.function, context);
    if (hotspot) candidates.set(hotspot.id, hotspot);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

function enrichDeoptWithCpuFrame(
  deopt: DeoptEntry,
  context: CpuHotspotContext,
  unknownFallbackHotspot?: Hotspot,
): DeoptEntry {
  if (deopt.function !== '<unknown>') {
    if (deopt.file && deopt.line > 0) return deopt;
    const matchingHotspot = findUniqueUserHotspotByFunction(deopt.function, context);
    return matchingHotspot ? deoptFromHotspot(deopt, matchingHotspot) : deopt;
  }
  if (!deopt.file || deopt.line <= 0) {
    return unknownFallbackHotspot ? deoptFromHotspot(deopt, unknownFallbackHotspot) : deopt;
  }
  const matchingHotspot = context.fullHotspots.find(
    (hotspot) =>
      hotspot.category === 'user' &&
      matchesDeoptFile(hotspot.file, deopt.file) &&
      Math.abs(hotspot.line - deopt.line) <= 1 &&
      hotspot.totalPct > 1,
  );
  if (!matchingHotspot) return deopt;
  return {
    ...deopt,
    function: matchingHotspot.function,
    file: matchingHotspot.file,
    line: matchingHotspot.line,
    ...(matchingHotspot.source ? { source: matchingHotspot.source } : {}),
  };
}

function findUniqueUserHotspotByFunction(
  functionName: string,
  context: CpuHotspotContext,
): Hotspot | undefined {
  const matches = context.fullHotspots.filter(
    (hotspot) =>
      hotspot.function === functionName && hotspot.category === 'user' && hotspot.totalPct > 1,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function deoptFromHotspot(deopt: DeoptEntry, hotspot: Hotspot): DeoptEntry {
  return {
    ...deopt,
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    ...(hotspot.source ? { source: hotspot.source } : {}),
  };
}

function matchesDeoptFile(hotspotFile: string, deoptFile: string): boolean {
  return hotspotFile === deoptFile || deoptFile.endsWith(`/${hotspotFile}`);
}
