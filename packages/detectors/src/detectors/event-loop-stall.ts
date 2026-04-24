import type { BuiltinFinding, EventLoopStallEvidenceExtra, Finding } from '@lanterna-profiler/core';
import { defineBuiltinFinding } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import type { Detector } from './types.js';

export const eventLoopStallDetector: Detector = {
  id: 'event-loop-stall',
  detect(report): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.eventLoopStall;
    const eventLoop = report.eventLoop;
    if (!eventLoop.available) return [];
    const p99LagMs = eventLoop.p99LagMs;
    const maxLagMs = eventLoop.maxLagMs;
    // Histogram-only measurement (no heartbeats) is less precise — raise thresholds
    // to avoid false positives on minor hiccups that heartbeats would resolve as noise.
    const isLowConfidence = eventLoop.confidence === 'low';
    const p99Threshold = isLowConfidence ? thresholds.p99LowConfidence : thresholds.p99;
    const maxThreshold = isLowConfidence ? thresholds.maxLowConfidence : thresholds.max;
    if (p99LagMs < p99Threshold && maxLagMs < maxThreshold) return [];

    const topCandidate = eventLoop.correlatedHotspots?.[0];
    const strongCorrelation =
      (eventLoop.measurementBasis === 'heartbeats' || eventLoop.measurementBasis === 'both') &&
      eventLoop.confidence === 'high' &&
      topCandidate !== undefined &&
      topCandidate.overlapPct >= thresholds.strongCorrelationOverlapPct;
    const severity: Finding['severity'] = maxLagMs > thresholds.critical ? 'critical' : 'warning';
    const evidenceExtra: EventLoopStallEvidenceExtra = {
      proofLevel: 'aggregate-correlation',
      p99LagMs,
      maxLagMs,
      measurementBasis: eventLoop.measurementBasis,
      confidence: eventLoop.confidence,
      histogram: eventLoop.histogram,
      stallIntervals: eventLoop.stallIntervals,
      candidateHotspots: eventLoop.correlatedHotspots ?? [],
    };

    return [
      defineBuiltinFinding<BuiltinFinding<'event-loop-stall'>['category']>({
        id: 'event-loop-stall',
        profileKind: 'cpu',
        severity,
        category: 'event-loop-stall',
        title: `Event loop stalled (max ${maxLagMs.toFixed(0)}ms)`,
        evidence: {
          file: strongCorrelation ? topCandidate.file : '(process)',
          line: strongCorrelation ? topCandidate.line : 0,
          function: strongCorrelation ? topCandidate.function : '(aggregate)',
          selfPct: strongCorrelation ? topCandidate.samplePct : 0,
          extra: evidenceExtra,
        },
        measurements: {
          observed: { p99LagMs, maxLagMs },
          thresholds: {
            p99: p99Threshold,
            max: maxThreshold,
            critical: thresholds.critical,
            strongCorrelationOverlapPct: thresholds.strongCorrelationOverlapPct,
          },
        },
        why: strongCorrelation
          ? `The event loop spent up to ${maxLagMs.toFixed(0)}ms (p99 ${p99LagMs.toFixed(0)}ms) without being able to pick up tasks. During those measured stall windows, \`${topCandidate.function}\` accounted for ${topCandidate.overlapPct.toFixed(1)}% of the user-code CPU samples.`
          : `The event loop spent up to ${maxLagMs.toFixed(0)}ms (p99 ${p99LagMs.toFixed(0)}ms) without being able to pick up tasks. The report includes ranked correlated hotspots, but no single user frame dominated the measured stall windows strongly enough to blame it on its own.`,
        suggestion: `Identify the hottest user-code function in this report and move its work off the main thread. Use \`worker_threads\` or \`piscina\` for CPU-bound work; chunk long loops with \`setImmediate\` or a queue; prefer streaming JSON for large payloads.`,
        references: [
          'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
          'https://github.com/piscinajs/piscina',
        ],
      }),
    ];
  },
};
