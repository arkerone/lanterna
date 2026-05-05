import type {
  AsyncTopOperation,
  BaseFinding,
  Finding,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import { anchorForFrame, asyncConfidence, asyncEvidenceExtra } from './async-evidence.js';

/**
 * Surfaces the longest-running async operations. Each finding is anchored on
 * the user-code frame captured at `init` (when available) so the agent can
 * jump straight to the call site that started the slow await.
 */
export const longAwaitDetector: KindScopedDetector<'async'> = {
  id: 'long-await',
  kindIds: ['async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.longAwait;
    const report = async.report;
    if (!report.summary.available) return [];
    if (report.summary.totalOperations < thresholds.minOperations) return [];

    const dropped = report.summary.recordsDropped > 0;
    const findings: Finding[] = [];
    for (const op of report.topOperations) {
      if (findings.length >= thresholds.maxFindings) break;
      if (op.durationMs < thresholds.minDurationMs) break; // sorted desc
      const severity: BaseFinding['severity'] =
        op.durationMs >= thresholds.criticalDurationMs ? 'critical' : 'warning';
      const category = op.kind === 'promise' ? 'long-promise-await' : 'long-io-await';
      const anchorFrame =
        op.kind === 'promise'
          ? (op.awaitFrame ?? op.promiseHandlerFrame ?? op.initFrame)
          : (op.creationFrame ?? op.initFrame);
      const anchor = anchorForFrame(report, anchorFrame);
      const frame = anchor.frame;
      const baseConfidence: BaseFinding['confidence'] = op.orphan ? 'medium' : 'high';
      const confidence: BaseFinding['confidence'] = dropped
        ? 'low'
        : asyncConfidence(report, baseConfidence);
      findings.push({
        id: `long-await:${op.asyncId}`,
        profileKind: 'async',
        severity,
        category,
        title: frame
          ? `${frame.function} kept an async ${op.kind} alive ${op.durationMs.toFixed(0)}ms`
          : `Async ${op.kind} (${op.rawType}) lived ${op.durationMs.toFixed(0)}ms`,
        confidence,
        proofLevel: 'direct-sample',
        evidence: {
          file: frame?.file ?? '(async)',
          line: frame?.line ?? 0,
          function: frame?.function ?? `${op.kind}#${op.asyncId}`,
          selfPct: 0,
          ...(frame?.source ? { source: frame.source } : {}),
          extra: {
            asyncId: op.asyncId,
            triggerAsyncId: op.triggerAsyncId,
            kind: op.kind,
            rawType: op.rawType,
            durationMs: op.durationMs,
            runMs: op.runMs,
            runCount: op.runCount,
            initAtMs: op.initAtMs,
            orphan: op.orphan,
            initStack: op.initStack,
            creationFrame: op.creationFrame ?? null,
            executionFrame: op.executionFrame ?? null,
            awaitFrame: op.awaitFrame ?? null,
            promiseRegistrationFrame: op.promiseRegistrationFrame ?? null,
            promiseHandlerFrame: op.promiseHandlerFrame ?? null,
            cdpAsyncContextFrame: op.cdpAsyncContextFrame ?? null,
            cdpAsyncStack: op.cdpAsyncStack ?? null,
            creationConfidence: op.creationConfidence ?? null,
            executionConfidence: op.executionConfidence ?? null,
            awaitConfidence: op.awaitConfidence ?? null,
            cdpAsyncContextConfidence: op.cdpAsyncContextConfidence ?? null,
            cpuAttributedSamples: op.cpuAttributedSamples ?? null,
            cpuAmbiguousSamples: op.cpuAmbiguousSamples ?? null,
            ...asyncEvidenceExtra(report, anchor),
          },
        },
        measurements: {
          observed: {
            durationMs: op.durationMs,
            runMs: op.runMs,
            runCount: op.runCount,
          },
          thresholds: {
            minDurationMs: thresholds.minDurationMs,
            criticalDurationMs: thresholds.criticalDurationMs,
          },
        },
        why: buildWhy(op, frame, dropped),
        suggestion: frame
          ? `Open \`${frame.file}:${frame.line}\` (\`${frame.function}\`) and add a timeout/abort path to this operation. Network and database calls should always carry a deadline (\`AbortController\`, axios \`timeout\`, \`pg\` statement_timeout, etc.).`
          : `Trace the trigger chain (triggerAsyncId=${op.triggerAsyncId}) to find the call site. Add explicit timeouts on network/database calls and verify every promise has a path to resolve or reject.`,
        references: [
          'https://nodejs.org/api/async_hooks.html',
          'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
        ],
      });
    }
    return findings;
  },
};

function buildWhy(
  op: AsyncTopOperation,
  frame: AsyncTopOperation['initFrame'],
  dropped: boolean,
): string {
  const head = frame
    ? `\`${frame.function}\` at \`${frame.file}:${frame.line}\` started an async ${op.kind} resource that lived ${op.durationMs.toFixed(0)}ms`
    : `An async ${op.kind} resource (${op.rawType}) was alive for ${op.durationMs.toFixed(0)}ms`;
  const tail = op.orphan ? ' and never resolved before the capture ended' : '';
  const drop = dropped
    ? ' Records were dropped during capture (`recordsDropped > 0`), so this is a lower bound.'
    : '';
  return `${head}${tail}.${drop} Long-lived async operations are usually slow I/O, network calls without a timeout, or promises waiting on something that already finished.`;
}
