import type {
  BuiltinFinding,
  CpuBoundUserHotspotEvidenceExtra,
  Finding,
  Hotspot,
  LanternaReport,
} from '../../report/types.js';
import { defineBuiltinFinding } from '../../report/types.js';
import type { Detector, FindingContext } from './types.js';
import { findStallCorrelation } from './shared.js';
import { DETECTOR_THRESHOLDS } from '../../shared/config.js';
import { stripOptPrefix } from '../../shared/frame.js';

const SPECIAL_CASE_PATTERNS = [
  /(^|\.)pbkdf2Sync$/,
  /(^|\.)scryptSync$/,
  /(^|\.)randomBytesSync$/,
  /(^|\.)readFileSync$/,
  /(^|\.)writeFileSync$/,
  /(^|\.)statSync$/,
  /(^|\.)existsSync$/,
  /(^|\.)readdirSync$/,
  /(^|\.)execSync$/,
  /(^|\.)execFileSync$/,
  /(^|\.)spawnSync$/,
  /(^|\.)gzipSync$/,
  /(^|\.)gunzipSync$/,
  /(^|\.)deflateSync$/,
  /(^|\.)inflateSync$/,
  /(^|\.)_load$/,
  /(^|\.)require$/,
  /(^|\.)loadESM$/,
  /(^|\.)JSON\.parse$/,
  /(^|\.)JSON\.stringify$/,
];

export const cpuBoundUserHotspotDetector: Detector = {
  id: 'cpu-bound-user-hotspot',
  order: 50,
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.cpuBoundUserHotspot;
    const hotspot = context.fullHotspots.find((candidate) => (
      candidate.category === 'user'
      && (
        candidate.selfPct >= thresholds.minSelfPct
        || candidate.totalPct >= thresholds.minTotalPct
      )
      && !isSpecialCase(candidate)
      && !isExplainedBySpecificCallee(candidate, context)
    ));
    if (!hotspot) return [];
    return [buildFinding(hotspot, report)];
  },
};

function buildFinding(
  hotspot: Hotspot,
  report: LanternaReport,
): BuiltinFinding<'cpu-bound-user-hotspot'> {
  const correlation = findStallCorrelation(hotspot, report);
  const thresholds = DETECTOR_THRESHOLDS.cpuBoundUserHotspot;
  const severity: Finding['severity'] = (
    hotspot.totalPct >= thresholds.criticalTotalPct
    || (correlation?.overlapPct ?? 0) >= thresholds.strongCorrelationOverlapPct
  ) ? 'critical' : 'warning';
  const evidenceExtra: CpuBoundUserHotspotEvidenceExtra = {
    totalPct: hotspot.totalPct,
    selfPct: hotspot.selfPct,
    eventLoopCorrelation: correlation,
  };

  return defineBuiltinFinding({
    id: `cpu-bound-user-hotspot:${hotspot.id}`,
    severity,
    category: 'cpu-bound-user-hotspot',
    title: `CPU-bound user-code hotspot (${hotspot.function})`,
    evidence: {
      file: hotspot.file,
      line: hotspot.line,
      function: hotspot.function,
      selfPct: hotspot.totalPct,
      extra: evidenceExtra,
    },
    why: `\`${hotspot.function}\` alone accounts for ${hotspot.totalPct.toFixed(1)}% of inclusive CPU time in user code on the main thread. Even without a more specific anti-pattern match, this is a dominant hotspot and a likely source of throughput loss or event-loop delay.`,
    suggestion: 'Reduce work per call, improve the algorithm, cache repeated results when valid, chunk long loops with setImmediate if latency matters, or move CPU-heavy work to worker_threads/piscina.',
    references: [
      'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
      'https://github.com/piscinajs/piscina',
    ],
  });
}

function isSpecialCase(hotspot: Hotspot): boolean {
  const normalizedFunctionName = stripOptPrefix(hotspot.function);
  return SPECIAL_CASE_PATTERNS.some((pattern) => pattern.test(normalizedFunctionName));
}

function isExplainedBySpecificCallee(
  hotspot: Hotspot,
  context: FindingContext,
): boolean {
  const explainedByDirectCallee = hotspot.callees.some((calleeRef) => {
    const callee = context.hotspotById.get(calleeRef.id);
    return callee !== undefined && isSpecialCase(callee);
  });
  if (explainedByDirectCallee) return true;

  return context.fullHotspots.some((candidate) => {
    if (!isSpecialCase(candidate)) return false;
    const attribution = context.userAttributionById.get(candidate.id);
    return (
      attribution?.file === hotspot.file
      && attribution.line === hotspot.line
      && attribution.function === hotspot.function
    );
  });
}
