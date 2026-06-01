import type {
  BuiltinFinding,
  ExcessiveGcEvidenceExtra,
  Finding,
  Hotspot,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import { findActionableUserCpuHotspot, selfHotspotUserCaller } from './shared.js';

export const excessiveGcDetector: KindScopedDetector<'cpu'> = {
  id: 'excessive-gc',
  kindIds: ['cpu'],
  detect({ cpu }, shared): Finding[] {
    const report = cpu.report;
    const thresholds = DETECTOR_THRESHOLDS.excessiveGc;
    const gcRatio = report.summary.gcRatio;
    const longestPauseMs = report.gc.longestPauseMs;
    // gcRatio is GC time / on-CPU time; it is noise on a near-idle process where
    // the on-CPU denominator is tiny. Only trust the ratio when the process did
    // meaningful on-CPU work. A genuine long pause still fires on its own.
    const gcRatioExceeded =
      gcRatio > thresholds.ratioTrigger && report.summary.onCpuRatio >= thresholds.minOnCpuRatio;
    const longPauseExceeded = longestPauseMs > thresholds.longestPauseTrigger;
    if (!gcRatioExceeded && !longPauseExceeded) return [];

    const totalTimedGcEvents = Object.values(report.gc.count).reduce(
      (sum, count) => sum + count,
      0,
    );
    const hasTimedGcEvidence = totalTimedGcEvents > 0 || report.gc.totalPauseMs > 0;
    const cpuKindMeta = shared.meta.kinds.cpu as { samplesTotal?: number } | undefined;
    const hasEnoughCpuSamplesForRatioOnly =
      shared.meta.durationMs >= thresholds.minDurationMs &&
      (cpuKindMeta?.samplesTotal ?? 0) >= thresholds.minSamples;
    if (
      gcRatioExceeded &&
      !longPauseExceeded &&
      !hasTimedGcEvidence &&
      !hasEnoughCpuSamplesForRatioOnly
    ) {
      return [];
    }

    const correlatedHotspots = report.gc.correlatedHotspots ?? [];
    const fallbackUserHotspot =
      correlatedHotspots.length > 0
        ? undefined
        : correlatedHotspotFromHotspot(findActionableUserCpuHotspot(report.hotspots));
    const gcCulpritHotspots =
      correlatedHotspots.length > 0
        ? correlatedHotspots
        : fallbackUserHotspot
          ? [fallbackUserHotspot]
          : [];
    const primaryGcHotspot = gcCulpritHotspots[0];
    const userCaller = primaryGcHotspot ? selfHotspotUserCaller(primaryGcHotspot) : undefined;
    const severity: Finding['severity'] =
      gcRatio > thresholds.ratioCritical || longestPauseMs > thresholds.longestPauseCritical
        ? 'critical'
        : 'warning';
    const evidenceSentences: string[] = [];
    if (gcRatioExceeded) {
      evidenceSentences.push(`GC consumed ${(gcRatio * 100).toFixed(1)}% of on-CPU time`);
    }
    if (longPauseExceeded) {
      evidenceSentences.push(`longest pause was ${longestPauseMs.toFixed(1)}ms`);
    }
    const evidenceExtra: ExcessiveGcEvidenceExtra = {
      proofLevel: 'aggregate-correlation',
      gcRatio,
      longestPauseMs,
      timedGcEventCount: totalTimedGcEvents,
      ratioConfidence: hasTimedGcEvidence ? 'high' : 'medium',
      counts: report.gc.count,
      candidateHotspots: gcCulpritHotspots,
      ...(userCaller ? { userCaller } : {}),
    };

    return [
      defineBuiltinFinding<BuiltinFinding<'excessive-gc'>['category']>({
        id: 'excessive-gc',
        profileKind: 'cpu',
        severity,
        category: 'excessive-gc',
        title: 'Excessive garbage collection',
        confidence: hasTimedGcEvidence ? 'high' : 'medium',
        proofLevel: 'correlated-window',
        evidence: {
          file: primaryGcHotspot?.file ?? '(process)',
          line: primaryGcHotspot?.line ?? 0,
          function: primaryGcHotspot?.function ?? '(aggregate)',
          selfPct: primaryGcHotspot?.samplePct ?? 0,
          ...(primaryGcHotspot?.source ? { source: primaryGcHotspot.source } : {}),
          extra: evidenceExtra,
        },
        measurements: {
          observed: { gcRatio, longestPauseMs },
          thresholds: {
            ratioTrigger: thresholds.ratioTrigger,
            longestPauseTrigger: thresholds.longestPauseTrigger,
            ratioCritical: thresholds.ratioCritical,
            longestPauseCritical: thresholds.longestPauseCritical,
          },
        },
        why: `${evidenceSentences.join(' and ')}. High GC usually means too many short-lived allocations on hot paths: unbounded caches, per-request object churn, large Buffer concat, or repeated JSON parse/stringify.`,
        suggestion: `Look at the top user-code hotspots for allocation patterns: replace array/string concat in loops with pre-sized buffers or streams, use bounded caches (lru-cache), reuse objects where safe, avoid \`JSON.parse(JSON.stringify(x))\` for deep clone (use \`structuredClone\`). Check old-space growth with \`--trace-gc --trace-gc-verbose\`.`,
        references: [
          'https://v8.dev/blog/trash-talk',
          'https://nodejs.org/api/perf_hooks.html#class-performanceobserver',
        ],
      }),
    ];
  },
};

function correlatedHotspotFromHotspot(
  hotspot: Hotspot | undefined,
): ExcessiveGcEvidenceExtra['candidateHotspots'][number] | undefined {
  if (!hotspot) return undefined;
  return {
    id: `${hotspot.file}:${hotspot.line}:${hotspot.function}`,
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    overlapPct: hotspot.totalPct,
    samplePct: hotspot.totalPct,
    rank: 1,
    confidence: 'medium',
    ...(hotspot.source ? { source: hotspot.source } : {}),
  };
}
