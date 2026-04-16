import type { BuiltinFinding, DeoptLoopEvidenceExtra, Finding } from '../../report/types.js';
import { defineBuiltinFinding } from '../../report/types.js';
import type { Detector, FindingContext } from './types.js';
import { DETECTOR_THRESHOLDS } from '../../shared/config.js';

export const deoptLoopDetector: Detector = {
  id: 'deopt-loop',
  detect(report, context): Finding[] {
    if (!report.meta.deep) return [];
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
        why: `${deopt.function} was deoptimised ${deopt.count} times. ${deopt.explanation}`,
        suggestion: `Stabilise the types and shapes passed to \`${deopt.function}\`. Keep hidden classes consistent (initialise all properties in the constructor in the same order), avoid mixing number/string args, and don't mutate the function's arguments shape across calls.`,
        references: [
          'https://v8.dev/blog/hidden-classes',
          'https://v8.dev/blog/elements-kinds',
        ],
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
  context: FindingContext,
) {
  return context.fullHotspots.find((hotspot) => (
    hotspot.function === functionName
    && matchesDeoptFile(hotspot.file, file)
    && Math.abs(hotspot.line - line) <= 1
    && hotspot.totalPct > 1
  ));
}

function matchesDeoptFile(hotspotFile: string, deoptFile: string): boolean {
  return hotspotFile === deoptFile || deoptFile.endsWith(`/${hotspotFile}`);
}
