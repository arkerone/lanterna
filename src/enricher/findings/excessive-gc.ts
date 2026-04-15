import type { Finding } from '../../report/types.js';
import type { Detector } from './types.js';

export const excessiveGcDetector: Detector = {
  id: 'excessive-gc',
  detect(report): Finding[] {
    const gcRatio = report.summary.gcRatio;
    const longest = report.gc.longestPauseMs;
    const ratioTrigger = gcRatio > 0.1;
    const pauseTrigger = longest > 100;
    if (!ratioTrigger && !pauseTrigger) return [];

    const totalTimedGcEvents = Object.values(report.gc.count).reduce((sum, count) => sum + count, 0);
    const hasTimedGcEvidence = totalTimedGcEvents > 0 || report.gc.totalPauseMs > 0;
    const hasEnoughCpuSamplesForRatioOnly = report.meta.durationMs >= 250 && report.meta.totalSamples >= 100;
    if (ratioTrigger && !pauseTrigger && !hasTimedGcEvidence && !hasEnoughCpuSamplesForRatioOnly) {
      return [];
    }

    const topCandidate = report.gc.correlatedHotspots?.[0];
    const severity: Finding['severity'] = gcRatio > 0.25 || longest > 250 ? 'critical' : 'warning';
    const parts: string[] = [];
    if (ratioTrigger) parts.push(`GC consumed ${(gcRatio * 100).toFixed(1)}% of on-CPU time`);
    if (pauseTrigger) parts.push(`longest pause was ${longest.toFixed(1)}ms`);

    return [
      {
        id: 'excessive-gc',
        severity,
        category: 'excessive-gc',
        title: 'Excessive garbage collection',
        evidence: {
          file: topCandidate?.file ?? '(process)',
          line: topCandidate?.line ?? 0,
          function: topCandidate?.function ?? '(aggregate)',
          selfPct: topCandidate?.samplePct ?? 0,
          extra: {
            gcRatio,
            longestPauseMs: longest,
            timedGcEventCount: totalTimedGcEvents,
            ratioConfidence: hasTimedGcEvidence ? 'high' : 'medium',
            counts: report.gc.count,
            candidateHotspots: report.gc.correlatedHotspots ?? [],
          },
        },
        why: `${parts.join(' and ')}. High GC usually means too many short-lived allocations on hot paths: unbounded caches, per-request object churn, large Buffer concat, or repeated JSON parse/stringify.`,
        suggestion: `Look at the top user-code hotspots for allocation patterns: replace array/string concat in loops with pre-sized buffers or streams, use bounded caches (lru-cache), reuse objects where safe, avoid \`JSON.parse(JSON.stringify(x))\` for deep clone (use \`structuredClone\`). Check old-space growth with \`--trace-gc --trace-gc-verbose\`.`,
        references: [
          'https://v8.dev/blog/trash-talk',
          'https://nodejs.org/api/perf_hooks.html#class-performanceobserver',
        ],
      },
    ];
  },
};
