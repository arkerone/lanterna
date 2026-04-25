import type {
  BuiltinFinding,
  DeoptLoopEvidenceExtra,
  Finding,
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
    for (const deopt of report.deopts) {
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
        severity: deopt.count > thresholds.criticalCount ? 'critical' : 'warning',
        category: 'deopt-loop',
        title: `Repeated deoptimisation of ${deopt.function} (${deopt.count}×)`,
        evidence: {
          file: deopt.file,
          line: deopt.line,
          function: deopt.function,
          selfPct: 0,
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

function findHotDeoptHotspot(
  functionName: string,
  file: string,
  line: number,
  context: CpuHotspotContext,
) {
  return context.fullHotspots.find(
    (hotspot) =>
      hotspot.function === functionName &&
      matchesDeoptFile(hotspot.file, file) &&
      Math.abs(hotspot.line - line) <= 1 &&
      hotspot.totalPct > 1,
  );
}

function matchesDeoptFile(hotspotFile: string, deoptFile: string): boolean {
  return hotspotFile === deoptFile || deoptFile.endsWith(`/${hotspotFile}`);
}
