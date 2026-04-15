import type { Finding } from '../../report/types.js';
import type { Detector } from './types.js';

export const eventLoopStallDetector: Detector = {
  id: 'event-loop-stall',
  detect(report): Finding[] {
    const el = report.eventLoop;
    if (!el.available) return [];
    const p99 = el.p99LagMs;
    const max = el.maxLagMs;
    // Histogram-only measurement (no heartbeats) is less precise — raise thresholds
    // to avoid false positives on minor hiccups that heartbeats would resolve as noise.
    const isLowConfidence = el.confidence === 'low';
    const p99Threshold = isLowConfidence ? 200 : 100;
    const maxThreshold = isLowConfidence ? 400 : 200;
    if (p99 < p99Threshold && max < maxThreshold) return [];

    const topCandidate = el.correlatedHotspots?.[0];
    const strongCorrelation = (
      (el.measurementBasis === 'heartbeats' || el.measurementBasis === 'both')
      && el.confidence === 'high'
      && topCandidate !== undefined
      && topCandidate.overlapPct >= 60
    );
    const severity: Finding['severity'] = max > 500 ? 'critical' : 'warning';

    return [
      {
        id: 'event-loop-stall',
        severity,
        category: 'event-loop-stall',
        title: `Event loop stalled (max ${max.toFixed(0)}ms)`,
        evidence: {
          file: strongCorrelation ? topCandidate.file : '(process)',
          line: strongCorrelation ? topCandidate.line : 0,
          function: strongCorrelation ? topCandidate.function : '(aggregate)',
          selfPct: strongCorrelation ? topCandidate.samplePct : 0,
          extra: {
            p99LagMs: p99,
            maxLagMs: max,
            measurementBasis: el.measurementBasis,
            confidence: el.confidence,
            histogram: el.histogram,
            stallIntervals: el.stallIntervals,
            candidateHotspots: el.correlatedHotspots ?? [],
          },
        },
        why: strongCorrelation
          ? `The event loop spent up to ${max.toFixed(0)}ms (p99 ${p99.toFixed(0)}ms) without being able to pick up tasks. During those measured stall windows, \`${topCandidate.function}\` accounted for ${topCandidate.overlapPct.toFixed(1)}% of the user-code CPU samples.`
          : `The event loop spent up to ${max.toFixed(0)}ms (p99 ${p99.toFixed(0)}ms) without being able to pick up tasks. The report includes ranked correlated hotspots, but no single user frame dominated the measured stall windows strongly enough to blame it on its own.`,
        suggestion: `Identify the hottest user-code function in this report and move its work off the main thread. Use \`worker_threads\` or \`piscina\` for CPU-bound work; chunk long loops with \`setImmediate\` or a queue; prefer streaming JSON for large payloads.`,
        references: [
          'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
          'https://github.com/piscinajs/piscina',
        ],
      },
    ];
  },
};
