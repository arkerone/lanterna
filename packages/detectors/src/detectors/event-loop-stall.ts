import type {
  AlternativeHotspotEvidence,
  BuiltinFinding,
  EventLoopStallEvidenceExtra,
  Finding,
  Hotspot,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';

export const eventLoopStallDetector: KindScopedDetector<'cpu'> = {
  id: 'event-loop-stall',
  kindIds: ['cpu'],
  detect({ cpu }): Finding[] {
    const report = cpu.report;
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
    const fallbackHotspots = fallbackUserHotspots(report.hotspots);
    const fallbackCandidate = strongCorrelation ? undefined : fallbackHotspots[0];
    const anchor = strongCorrelation ? topCandidate : fallbackCandidate;
    const proofLevel = strongCorrelation ? 'aggregate-correlation' : 'hotspot-fallback';
    const severity: Finding['severity'] = maxLagMs > thresholds.critical ? 'critical' : 'warning';
    const evidenceExtra: EventLoopStallEvidenceExtra = {
      proofLevel,
      p99LagMs,
      maxLagMs,
      sampleCount: eventLoop.sampleCount,
      measurementBasis: eventLoop.measurementBasis,
      confidence: eventLoop.confidence,
      histogram: eventLoop.histogram,
      stallIntervals: eventLoop.stallIntervals,
      candidateHotspots: eventLoop.correlatedHotspots ?? [],
      fallbackHotspots: fallbackHotspots.length > 0 ? fallbackHotspots : undefined,
      correlationCoverage: eventLoop.correlationCoverage,
    };

    return [
      defineBuiltinFinding<BuiltinFinding<'event-loop-stall'>['category']>({
        id: 'event-loop-stall',
        profileKind: 'cpu',
        severity,
        category: 'event-loop-stall',
        title: `Event loop stalled (max ${maxLagMs.toFixed(0)}ms)`,
        confidence: strongCorrelation ? 'high' : fallbackCandidate ? 'medium' : 'medium',
        proofLevel: strongCorrelation ? 'correlated-window' : 'heuristic',
        evidence: {
          file: anchor?.file ?? '(process)',
          line: anchor?.line ?? 0,
          function: anchor?.function ?? '(aggregate)',
          selfPct: strongCorrelation ? topCandidate.samplePct : (fallbackCandidate?.selfPct ?? 0),
          ...(anchor?.source ? { source: anchor.source } : {}),
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
          : fallbackCandidate
            ? `The event loop spent up to ${maxLagMs.toFixed(0)}ms (p99 ${p99LagMs.toFixed(0)}ms) without being able to pick up tasks. No measured stall window had enough attribution to blame a single frame, but \`${fallbackCandidate.function}\` is the hottest user-code CPU frame in the same capture (${fallbackCandidate.selfPct.toFixed(1)}% self, ${fallbackCandidate.totalPct.toFixed(1)}% total).`
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

function fallbackUserHotspots(hotspots: readonly Hotspot[]): AlternativeHotspotEvidence[] {
  return hotspots
    .filter((hotspot) => hotspot.category === 'user')
    .filter((hotspot) => hotspot.selfPct >= 10 || hotspot.totalPct >= 25)
    .sort((left, right) => {
      const selfDelta = right.selfPct - left.selfPct;
      if (selfDelta !== 0) return selfDelta;
      return right.totalPct - left.totalPct;
    })
    .slice(0, 3)
    .map((hotspot) => ({
      id: hotspot.id,
      function: hotspot.function,
      file: hotspot.source?.file ?? hotspot.file,
      line: hotspot.source?.line ?? hotspot.line,
      selfPct: hotspot.selfPct,
      totalPct: hotspot.totalPct,
      ...(hotspot.source ? { source: hotspot.source } : {}),
    }));
}
