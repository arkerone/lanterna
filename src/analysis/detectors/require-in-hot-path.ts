import type { BuiltinFinding, Finding, Hotspot } from '../../report/types.js';
import { defineBuiltinFinding } from '../../report/types.js';
import type { Detector } from './types.js';
import { stripOptPrefix } from '../../shared/frame.js';
import { DETECTOR_THRESHOLDS } from '../../shared/config.js';

const PATTERNS = [
  /(^|\.)_load$/,      // Module._load (CJS require)
  /(^|\.)require$/,
  /(^|\.)loadESM$/,
];

export const requireInHotPathDetector: Detector = {
  id: 'require-in-hot-path',
  detect(_report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.requireInHotPath;
    const findings: Finding[] = [];
    for (const hotspot of context.fullHotspots) {
      const normalizedFunctionName = stripOptPrefix(hotspot.function);
      if (!PATTERNS.some((pattern) => pattern.test(normalizedFunctionName))) continue;
      if (hotspot.category !== 'node:builtin' && hotspot.category !== 'node_modules') continue;
      if (hotspot.selfPct < thresholds.minSelfPct && hotspot.totalPct < thresholds.minTotalPct) continue;
      findings.push(buildFinding(hotspot));
    }
    return findings;
  },
};

function buildFinding(hotspot: Hotspot): BuiltinFinding<'require-in-hot-path'> {
  return defineBuiltinFinding({
    id: `require-in-hot-path`,
    severity: hotspot.selfPct > DETECTOR_THRESHOLDS.requireInHotPath.warningSelfPct ? 'warning' : 'info',
    category: 'require-in-hot-path',
    title: 'Module loading on hot path',
    evidence: {
      file: hotspot.file,
      line: hotspot.line,
      function: hotspot.function,
      selfPct: hotspot.selfPct,
    },
    why: `\`${hotspot.function}\` is being called during request handling. Module resolution and graph loading are expensive and normally only happen once at startup; hitting them per request implies a lazy require/import inside a hot function.`,
    suggestion: `Hoist the \`require(...)\` / \`await import(...)\` to module top-level (or to an init hook called once at boot). If you truly need lazy loading, memoise the result yourself.`,
    references: [
      'https://nodejs.org/api/modules.html#modulerequireid',
    ],
  });
}
