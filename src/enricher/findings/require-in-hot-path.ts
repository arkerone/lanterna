import type { Finding, Hotspot } from '../../report/types.js';
import type { Detector } from './types.js';

const PATTERNS = [
  /(^|\.)_load$/,      // Module._load (CJS require)
  /(^|\.)require$/,
  /(^|\.)loadESM$/,
];

export const requireInHotPathDetector: Detector = {
  id: 'require-in-hot-path',
  detect(report, context): Finding[] {
    const findings: Finding[] = [];
    for (const h of context.fullHotspots) {
      const fn = h.function.replace(/^[*~]/, '');
      if (!PATTERNS.some((re) => re.test(fn))) continue;
      if (h.category !== 'node:builtin' && h.category !== 'node_modules') continue;
      if (h.selfPct < 0.5 && h.totalPct < 1) continue;
      findings.push(buildFinding(h));
    }
    return findings;
  },
};

function buildFinding(h: Hotspot): Finding {
  return {
    id: `require-in-hot-path`,
    severity: h.selfPct > 3 ? 'warning' : 'info',
    category: 'require-in-hot-path',
    title: 'Module loading on hot path',
    evidence: {
      file: h.file,
      line: h.line,
      function: h.function,
      selfPct: h.selfPct,
    },
    why: `\`${h.function}\` is being called during request handling. Module resolution and graph loading are expensive and normally only happen once at startup; hitting them per request implies a lazy require/import inside a hot function.`,
    suggestion: `Hoist the \`require(...)\` / \`await import(...)\` to module top-level (or to an init hook called once at boot). If you truly need lazy loading, memoise the result yourself.`,
    references: [
      'https://nodejs.org/api/modules.html#modulerequireid',
    ],
  };
}
