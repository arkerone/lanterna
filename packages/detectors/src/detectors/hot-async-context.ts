import type {
  AsyncCpuAttributionEntry,
  BaseFinding,
  Finding,
  KindScopedDetector,
} from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import { anchorForFrame, asyncConfidence, asyncEvidenceExtra } from './async-evidence.js';

/**
 * Cross-kind detector: maps hot CPU back to the async chain that produced it
 * by intersecting CPU sample timestamps with the `before/after` run windows
 * captured via `async_hooks`.
 *
 * Fires when a single async chain root accounts for a meaningful fraction of
 * the CPU work — that's the call site to optimize first. Skips silently when
 * either the CPU or async kind is missing from the capture.
 */
export const hotAsyncContextDetector: KindScopedDetector<'cpu' | 'async'> = {
  id: 'hot-async-context',
  kindIds: ['cpu', 'async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.hotAsyncContext;
    const attribution = async.report.cpuAttribution;
    if (!attribution.available) return [];
    if (attribution.attributedCpuPct < thresholds.minAttributedCoveragePct) return [];

    const findings: Finding[] = [];
    const dropped = async.report.summary.recordsDropped > 0;
    for (const entry of attribution.topChains) {
      if (findings.length >= thresholds.maxFindings) break;
      if (entry.cpuPct < thresholds.minCpuPct) break; // sorted desc
      const severity: BaseFinding['severity'] =
        entry.cpuPct >= thresholds.criticalCpuPct ? 'critical' : 'warning';
      const anchor = anchorForFrame(async.report, entry.executionFrame ?? entry.rootFrame);
      const frame = anchor.frame;
      findings.push({
        id: `hot-async-context:${entry.rootAsyncId}`,
        profileKind: 'async',
        severity,
        category: 'hot-async-context',
        title: titleFor(entry),
        confidence: dropped ? 'low' : asyncConfidence(async.report, 'high'),
        proofLevel: 'correlated-window',
        evidence: {
          file: frame?.file ?? '(async)',
          line: frame?.line ?? 0,
          function: frame?.function ?? `chain#${entry.rootAsyncId}`,
          selfPct: entry.cpuPct,
          extra: {
            rootAsyncId: entry.rootAsyncId,
            rootKind: entry.rootKind,
            rootFrame: entry.rootFrame ?? null,
            executionFrame: entry.executionFrame ?? null,
            executionConfidence: entry.executionConfidence ?? null,
            cpuPct: entry.cpuPct,
            cpuMs: entry.cpuMs,
            contributingOperations: entry.contributingOperations,
            attributedCpuPct: attribution.attributedCpuPct,
            ...asyncEvidenceExtra(async.report, anchor),
          },
        },
        measurements: {
          observed: {
            cpuPct: entry.cpuPct,
            cpuMs: entry.cpuMs,
            contributingOperations: entry.contributingOperations,
            attributedCpuPct: attribution.attributedCpuPct,
          },
          thresholds: {
            minCpuPct: thresholds.minCpuPct,
            criticalCpuPct: thresholds.criticalCpuPct,
            minAttributedCoveragePct: thresholds.minAttributedCoveragePct,
          },
        },
        why: buildWhy(entry, attribution.attributedCpuPct, dropped),
        suggestion: entry.rootFrame
          ? `Open \`${entry.rootFrame.file}:${entry.rootFrame.line}\` (\`${entry.rootFrame.function}\`) — that's the async entry point driving ${entry.cpuPct.toFixed(1)}% of CPU. Optimizations land here with the highest leverage: cache results, batch fan-out, or move CPU-bound work to a worker thread.`
          : `Inspect the async chain rooted at asyncId=${entry.rootAsyncId}; CPU samples accumulated under its descendants account for ${entry.cpuPct.toFixed(1)}% of CPU.`,
        references: [
          'https://nodejs.org/api/async_hooks.html',
          'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
        ],
      });
    }
    return findings;
  },
};

function titleFor(entry: AsyncCpuAttributionEntry): string {
  const where = entry.rootFrame
    ? `\`${entry.rootFrame.function}\``
    : `async chain#${entry.rootAsyncId}`;
  return `${where} accounts for ${entry.cpuPct.toFixed(1)}% of CPU (${entry.contributingOperations} async ops)`;
}

function buildWhy(entry: AsyncCpuAttributionEntry, coveragePct: number, dropped: boolean): string {
  const where = entry.rootFrame
    ? `\`${entry.rootFrame.function}\` at \`${entry.rootFrame.file}:${entry.rootFrame.line}\``
    : `async chain root #${entry.rootAsyncId}`;
  const drop = dropped
    ? ' (recordsDropped > 0; this is a lower bound on CPU attributed to that chain.)'
    : '';
  return `CPU samples whose timestamps fall inside the \`before/after\` windows of the async resources triggered by ${where} sum to ${entry.cpuPct.toFixed(1)}% of total CPU (${entry.cpuMs.toFixed(0)}ms across ${entry.contributingOperations} async ops). Capture-wide coverage of attributed CPU was ${coveragePct.toFixed(1)}%.${drop}`;
}
