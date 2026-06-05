import type { Finding } from '@lanterna-profiler/core';
import type { OutputFormat } from '../parse.js';
import type { FindingChange, ReportDiff, ScalarDelta } from './diff-report.js';

function fmtNum(value: number | undefined): string {
  if (value === undefined) return '—';
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) < 10) return value.toFixed(3);
  return value.toFixed(1);
}

function findingLine(finding: Finding): string {
  return `[${finding.severity}] ${finding.id} — ${finding.title} (${finding.profileKind})`;
}

function changeLine(change: FindingChange): string {
  const parts: string[] = [];
  if (change.severityFrom !== change.severityTo) {
    parts.push(
      `severity ${change.severityFrom} → ${change.severityTo} (${change.severityDirection})`,
    );
  }
  if ((change.confidenceFrom ?? undefined) !== (change.confidenceTo ?? undefined)) {
    parts.push(`confidence ${change.confidenceFrom ?? '—'} → ${change.confidenceTo ?? '—'}`);
  }
  if (change.scoreFrom !== undefined && change.scoreTo !== undefined) {
    parts.push(`score ${Math.round(change.scoreFrom)} → ${Math.round(change.scoreTo)}`);
  }
  return `${change.id} — ${parts.join(', ')} (${change.profileKind})`;
}

function deltaLine(delta: ScalarDelta): string {
  const arrow =
    delta.delta === undefined
      ? ''
      : ` (Δ ${delta.delta >= 0 ? '+' : ''}${fmtNum(delta.delta)}) ${delta.direction}`;
  return `${delta.kind} ${delta.label}: ${fmtNum(delta.from)} → ${fmtNum(delta.to)}${arrow}`;
}

function metaLine(meta: ReportDiff['baseline']): string {
  const kinds = meta.profileKinds.length > 0 ? meta.profileKinds.join(',') : '(none)';
  return `${meta.mode}, ${meta.durationMs}ms, kinds ${kinds}, ${meta.findingCount} findings`;
}

function renderBody(diff: ReportDiff, heading: (text: string) => string): string[] {
  const lines: string[] = [];
  lines.push(`baseline: ${metaLine(diff.baseline)}`);
  lines.push(`current:  ${metaLine(diff.current)}`);
  lines.push('');
  lines.push(`Result: ${diff.regressed ? 'REGRESSED' : 'no regression'}`);
  lines.push('');

  lines.push(heading('Findings'));
  lines.push(`added (${diff.findings.added.length}):`);
  for (const f of diff.findings.added) lines.push(`  + ${findingLine(f)}`);
  lines.push(`removed (${diff.findings.removed.length}):`);
  for (const f of diff.findings.removed) lines.push(`  - ${findingLine(f)}`);
  lines.push(`changed (${diff.findings.changed.length}):`);
  for (const c of diff.findings.changed) lines.push(`  ~ ${changeLine(c)}`);
  lines.push(`unchanged: ${diff.findings.unchangedCount}`);

  if (diff.scalarDeltas.length > 0) {
    lines.push('');
    lines.push(heading('Metric deltas'));
    for (const d of diff.scalarDeltas) lines.push(`  ${deltaLine(d)}`);
  }
  return lines;
}

function renderText(diff: ReportDiff): string {
  const body = renderBody(diff, (text) => `${text}:`);
  return ['Report Diff', '', ...body].join('\n');
}

function renderMarkdown(diff: ReportDiff): string {
  const body = renderBody(diff, (text) => `## ${text}`);
  return ['# Report Diff', '', ...body].join('\n');
}

function renderAgent(diff: ReportDiff): string {
  const frontmatter = [
    '---',
    `regressed: ${diff.regressed}`,
    `baseline_findings: ${diff.baseline.findingCount}`,
    `current_findings: ${diff.current.findingCount}`,
    `added: ${diff.findings.added.length}`,
    `removed: ${diff.findings.removed.length}`,
    `changed: ${diff.findings.changed.length}`,
    `unchanged: ${diff.findings.unchangedCount}`,
    '---',
  ];
  const body = renderBody(diff, (text) => `## ${text}`);
  return [...frontmatter, '', '# Report Diff', '', ...body].join('\n');
}

export function renderDiff(diff: ReportDiff, format: OutputFormat, pretty: boolean): string {
  switch (format) {
    case 'json':
      return JSON.stringify(diff, null, pretty ? 2 : 0);
    case 'markdown':
      return renderMarkdown(diff);
    case 'agent':
      return renderAgent(diff);
    default:
      return renderText(diff);
  }
}
