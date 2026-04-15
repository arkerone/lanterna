import type { Finding } from '../../report/types.js';
import type { Detector } from './types.js';

export const deoptLoopDetector: Detector = {
  id: 'deopt-loop',
  detect(report): Finding[] {
    if (!report.meta.deep) return [];
    const findings: Finding[] = [];
    for (const d of report.deopts) {
      if (d.count < 5) continue;
      findings.push({
        id: `deopt-loop:${d.function}`,
        severity: d.count > 20 ? 'critical' : 'warning',
        category: 'deopt-loop',
        title: `Repeated deoptimisation of ${d.function} (${d.count}×)`,
        evidence: {
          file: d.file,
          line: d.line,
          function: d.function,
          selfPct: 0,
          extra: { reason: d.reason, bailoutType: d.bailoutType, count: d.count },
        },
        why: `${d.function} was deoptimised ${d.count} times. ${d.explanation}`,
        suggestion: `Stabilise the types and shapes passed to \`${d.function}\`. Keep hidden classes consistent (initialise all properties in the constructor in the same order), avoid mixing number/string args, and don't mutate the function's arguments shape across calls.`,
        references: [
          'https://v8.dev/blog/hidden-classes',
          'https://v8.dev/blog/elements-kinds',
        ],
      });
    }
    return findings;
  },
};
