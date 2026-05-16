import type { BaseFinding, Finding, KindScopedDetector } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import {
  anchorForFrame,
  asyncConfidence,
  asyncEvidenceExtra,
  resolveAsyncUserCaller,
} from './async-evidence.js';

/**
 * Fires when the inflight async resource count stays high for the duration
 * of the capture. Sustained backlog indicates the app is producing async
 * work faster than the loop can drain it — typically unthrottled fan-out or
 * runaway timers.
 */
export const microtaskFloodDetector: KindScopedDetector<'async'> = {
  id: 'microtask-flood',
  kindIds: ['async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.microtaskFlood;
    const report = async.report;
    if (!report.summary.available) return [];
    const concurrency = report.summary.concurrency;
    if (!concurrency) return [];
    if (report.concurrencyTimeline.length < thresholds.minSamples) return [];
    if (concurrency.meanInflight < thresholds.meanInflight) return [];

    const dropped = report.summary.recordsDropped > 0;
    const severity: BaseFinding['severity'] =
      concurrency.maxInflight >= thresholds.criticalMaxInflight ? 'critical' : 'warning';
    const anchor = anchorForFrame(report, undefined);
    const frame = anchor.frame;
    const userCaller = resolveAsyncUserCaller(anchor.hotFile, frame, {
      confidence: anchor.hotFile?.confidence ?? 'medium',
      basis: 'async-stack',
    });

    return [
      {
        id: 'microtask-flood',
        profileKind: 'async',
        severity,
        category: 'microtask-flood',
        title: `Sustained async backlog: ${concurrency.meanInflight.toFixed(0)} inflight resources on average`,
        confidence: dropped ? 'low' : asyncConfidence(report, 'high'),
        proofLevel: 'correlated-window',
        evidence: {
          file: frame?.file ?? '(async)',
          line: frame?.line ?? 0,
          function: frame?.function ?? '(concurrency)',
          selfPct: 0,
          ...(frame?.source ? { source: frame.source } : {}),
          extra: {
            meanInflight: concurrency.meanInflight,
            maxInflight: concurrency.maxInflight,
            meanActive: concurrency.meanActive,
            maxActive: concurrency.maxActive,
            samples: report.concurrencyTimeline.length,
            ...(userCaller ? { userCaller } : {}),
            ...asyncEvidenceExtra(report, anchor),
          },
        },
        measurements: {
          observed: {
            meanInflight: concurrency.meanInflight,
            maxInflight: concurrency.maxInflight,
            meanActive: concurrency.meanActive,
            maxActive: concurrency.maxActive,
          },
          thresholds: {
            meanInflight: thresholds.meanInflight,
            criticalMaxInflight: thresholds.criticalMaxInflight,
          },
        },
        why: `The capture observed an average of ${concurrency.meanInflight.toFixed(0)} async resources inflight (peak ${concurrency.maxInflight}). When the loop is fed work faster than it drains it, latency rises and memory grows from queued continuations — this is the async equivalent of a thread-pool saturation.`,
        suggestion: `Throttle producers: cap concurrency on outgoing requests (e.g. \`p-limit\`, semaphore), batch fan-out work, and verify that no timer/Promise schedules itself recursively. If this is a queue-consumer, scale workers or bound the queue.`,
        references: [
          'https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick',
          'https://github.com/sindresorhus/p-limit',
        ],
      },
    ];
  },
};
