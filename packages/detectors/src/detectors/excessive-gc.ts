import type { BuiltinFinding, ExcessiveGcEvidenceExtra, Finding } from '@lanterna/core';
import { defineBuiltinFinding } from '@lanterna/core';
import type { Detector } from './types.js';
import { DETECTOR_THRESHOLDS } from '../config.js';

export const excessiveGcDetector: Detector = {
  id: 'excessive-gc',
  detect(report): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.excessiveGc;
    const gcRatio = report.summary.gcRatio;
    const longestPauseMs = report.gc.longestPauseMs;
    const ratioTrigger = gcRatio > thresholds.ratioTrigger;
    const pauseTrigger = longestPauseMs > thresholds.longestPauseTrigger;
    if (!ratioTrigger && !pauseTrigger) return [];

    const totalTimedGcEvents = Object.values(report.gc.count).reduce((sum, count) => sum + count, 0);
    const hasTimedGcEvidence = totalTimedGcEvents > 0 || report.gc.totalPauseMs > 0;
    const hasEnoughCpuSamplesForRatioOnly = (
      report.meta.durationMs >= thresholds.minDurationMs
      && report.meta.totalSamples >= thresholds.minSamples
    );
    if (ratioTrigger && !pauseTrigger && !hasTimedGcEvidence && !hasEnoughCpuSamplesForRatioOnly) {
      return [];
    }

    const topCandidate = report.gc.correlatedHotspots?.[0];
    const severity: Finding['severity'] = (
      gcRatio > thresholds.ratioCritical || longestPauseMs > thresholds.longestPauseCritical
    ) ? 'critical' : 'warning';
    const evidenceParts: string[] = [];
    if (ratioTrigger) evidenceParts.push(`GC consumed ${(gcRatio * 100).toFixed(1)}% of on-CPU time`);
    if (pauseTrigger) evidenceParts.push(`longest pause was ${longestPauseMs.toFixed(1)}ms`);
    const evidenceExtra: ExcessiveGcEvidenceExtra = {
      proofLevel: 'aggregate-correlation',
      gcRatio,
      longestPauseMs,
      timedGcEventCount: totalTimedGcEvents,
      ratioConfidence: hasTimedGcEvidence ? 'high' : 'medium',
      counts: report.gc.count,
      candidateHotspots: report.gc.correlatedHotspots ?? [],
    };

    return [
      defineBuiltinFinding<BuiltinFinding<'excessive-gc'>['category']>({
        id: 'excessive-gc',
        severity,
        category: 'excessive-gc',
        title: 'Excessive garbage collection',
        evidence: {
          file: topCandidate?.file ?? '(process)',
          line: topCandidate?.line ?? 0,
          function: topCandidate?.function ?? '(aggregate)',
          selfPct: topCandidate?.samplePct ?? 0,
          extra: evidenceExtra,
        },
        why: `${evidenceParts.join(' and ')}. High GC usually means too many short-lived allocations on hot paths: unbounded caches, per-request object churn, large Buffer concat, or repeated JSON parse/stringify.`,
        suggestion: `Look at the top user-code hotspots for allocation patterns: replace array/string concat in loops with pre-sized buffers or streams, use bounded caches (lru-cache), reuse objects where safe, avoid \`JSON.parse(JSON.stringify(x))\` for deep clone (use \`structuredClone\`). Check old-space growth with \`--trace-gc --trace-gc-verbose\`.`,
        references: [
          'https://v8.dev/blog/trash-talk',
          'https://nodejs.org/api/perf_hooks.html#class-performanceobserver',
        ],
      }),
    ];
  },
};
