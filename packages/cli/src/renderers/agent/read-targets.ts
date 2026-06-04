import type { LanternaReport } from '@lanterna-profiler/core';
import { appendTable } from './markdown.js';
import { collectReadTargets, formatReadTargetReason } from './read-target-collector.js';

export function appendFilesToReadFirst(lines: string[], report: LanternaReport): void {
  lines.push('## Files To Read First');
  lines.push('');
  const targets = collectReadTargets(report);
  if (targets.length === 0) {
    lines.push('_no editable user source files identified from findings or aggregates_');
    return;
  }
  appendTable(
    lines,
    ['location', 'reason', 'source', 'signal', 'decision'],
    targets.map((target) => [
      target.location,
      formatReadTargetReason(target.reason),
      target.source,
      target.signal,
      target.decision,
    ]),
  );
}
