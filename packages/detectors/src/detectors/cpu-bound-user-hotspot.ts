import type {
  BuiltinFinding,
  CpuBoundUserHotspotEvidenceExtra,
  Finding,
  Hotspot,
  LanternaReport,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding, stripOptPrefix } from '@lanterna-profiler/core';
import {
  BLOCKING_IO_PATTERNS,
  DETECTOR_THRESHOLDS,
  JSON_FUNCTION_PATTERNS,
  REQUIRE_PATTERNS,
  SYNC_CRYPTO_FNS,
} from '../config.js';
import { findStallCorrelation, toAlternativeHotspotEvidence } from './shared.js';
import type { Detector, FindingContext } from './types.js';

// Derived from the individual detector pattern sources so that cpu-bound exclusions
// automatically stay in sync when a new pattern is added to another detector.
const SPECIAL_CASE_PATTERNS: ReadonlyArray<RegExp> = [
  ...SYNC_CRYPTO_FNS.map((name) => new RegExp(`(^|\\.)${name}$`)),
  ...BLOCKING_IO_PATTERNS.map((p) => p.re),
  ...REQUIRE_PATTERNS,
  ...JSON_FUNCTION_PATTERNS.map((p) => p.re),
];

export const cpuBoundUserHotspotDetector: Detector = {
  id: 'cpu-bound-user-hotspot',
  order: 50,
  detect(report, context): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.cpuBoundUserHotspot;
    const matches = context.fullHotspots
      .filter(
        (candidate) =>
          candidate.category === 'user' &&
          (candidate.selfPct >= thresholds.minSelfPct ||
            candidate.totalPct >= thresholds.minTotalPct) &&
          !isSpecialCase(candidate) &&
          !isExplainedBySpecificCallee(candidate, context),
      )
      .sort((left, right) => {
        const totalDelta = right.totalPct - left.totalPct;
        if (totalDelta !== 0) return totalDelta;
        return right.selfPct - left.selfPct;
      });
    const hotspot = matches[0];
    if (!hotspot) return [];
    return [buildFinding(hotspot, matches.slice(1, 3), report)];
  },
};

function buildFinding(
  hotspot: Hotspot,
  alternatives: Hotspot[],
  report: LanternaReport,
): BuiltinFinding<'cpu-bound-user-hotspot'> {
  const correlation = findStallCorrelation(hotspot, report);
  const thresholds = DETECTOR_THRESHOLDS.cpuBoundUserHotspot;
  const severity: Finding['severity'] =
    hotspot.totalPct >= thresholds.criticalTotalPct ||
    (correlation?.overlapPct ?? 0) >= thresholds.strongCorrelationOverlapPct
      ? 'critical'
      : 'warning';
  const evidenceExtra: CpuBoundUserHotspotEvidenceExtra = {
    proofLevel: correlation ? 'attributed-caller' : 'aggregate-correlation',
    totalPct: hotspot.totalPct,
    selfPct: hotspot.selfPct,
    eventLoopCorrelation: correlation,
    alternativeHotspots: alternatives.map(toAlternativeHotspotEvidence),
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
    measurements: {
      observed: {
        selfPct: hotspot.selfPct,
        totalPct: hotspot.totalPct,
        correlationOverlapPct: correlation?.overlapPct ?? 0,
      },
      thresholds: {
        minSelfPct: thresholds.minSelfPct,
        minTotalPct: thresholds.minTotalPct,
        warningTotalPct: thresholds.warningTotalPct,
        criticalTotalPct: thresholds.criticalTotalPct,
        strongCorrelationOverlapPct: thresholds.strongCorrelationOverlapPct,
      },
    },
    why: `\`${hotspot.function}\` alone accounts for ${hotspot.totalPct.toFixed(1)}% of inclusive CPU time in user code on the main thread. Even without a more specific anti-pattern match, this is a dominant hotspot and a likely source of throughput loss or event-loop delay.`,
    suggestion:
      'Reduce work per call, improve the algorithm, cache repeated results when valid, chunk long loops with setImmediate if latency matters, or move CPU-heavy work to worker_threads/piscina.',
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

/**
 * A dedup gate: hide the generic "CPU-bound user hotspot" finding when a more
 * specific detector (blocking-io, sync-crypto, require, json) already explains
 * the same frame. Two paths qualify as "already explained":
 *
 * 1. Direct callee: the user hotspot calls a special-case builtin directly.
 * 2. Sample-path attribution: a special-case builtin was attributed back to
 *    this user frame with enough support (≥60%). Using 60% (not 80% "high"
 *    confidence) avoids double-findings in the 60-80% band where the specific
 *    detector *will* emit but attribution is not yet marked high-confidence.
 */
const ATTRIBUTION_DEDUP_SUPPORT_THRESHOLD = 60;

function isExplainedBySpecificCallee(hotspot: Hotspot, context: FindingContext): boolean {
  const explainedByDirectCallee = hotspot.callees.some((calleeRef) => {
    const callee = context.hotspotById.get(calleeRef.id);
    return callee !== undefined && isSpecialCase(callee);
  });
  if (explainedByDirectCallee) return true;

  return context.fullHotspots.some((candidate) => {
    if (!isSpecialCase(candidate)) return false;
    const attribution = context.userAttributionById.get(candidate.id);
    if (!attribution) return false;
    if (attribution.supportPct < ATTRIBUTION_DEDUP_SUPPORT_THRESHOLD) return false;
    return (
      attribution.file === hotspot.file &&
      attribution.line === hotspot.line &&
      attribution.function === hotspot.function
    );
  });
}
