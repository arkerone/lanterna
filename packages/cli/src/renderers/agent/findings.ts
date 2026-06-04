import type { Finding, LanternaReport } from '@lanterna-profiler/core';
import {
  basisSuffix,
  candidateCallersFromEvidenceExtra,
  correlatedAllocatorFromEvidenceExtra,
  cpuUserStackForFinding,
  entryFrameFromEvidenceExtra,
  formatUserCallerCompact,
  frameLabel,
  frameLocation,
  preferredLocation,
  preferredLocationWithFallback,
  userCallerFromEvidenceExtra,
  userCallerSuffix,
} from './frames.js';
import { appendTable } from './markdown.js';
import {
  formatImpact,
  formatMeasurements,
  formatRemediation,
  formatScalarOrDash,
} from './values.js';

export function appendFindings(lines: string[], report: LanternaReport): void {
  const findings = report.findings ?? [];
  lines.push('## Findings');
  lines.push('');
  if (findings.length === 0) {
    lines.push('_no findings_');
    return;
  }
  const headers = [
    '#',
    'id',
    'kind',
    'prio',
    'sev',
    'conf',
    'proof',
    'decision',
    'location',
    'impact',
  ];
  const rows = findings.map((finding, index) => [
    String(index + 1),
    finding.id,
    finding.profileKind,
    formatScalarOrDash(finding.priority?.score),
    finding.severity,
    finding.confidence ?? '—',
    finding.proofLevel ?? proofLevelFromExtra(finding) ?? '—',
    decisionForFinding(finding),
    preferredLocation(finding),
    formatImpact(finding),
  ]);
  appendTable(lines, headers, rows);
  lines.push('');
  findings.forEach((finding, index) => {
    appendFindingDetail(lines, finding, index + 1, report);
    if (index < findings.length - 1) lines.push('');
  });
}

export function decisionForFinding(finding: Finding): 'actionable' | 'hypothesis' | 'rerun' {
  if (finding.confidence === 'low') return 'hypothesis';
  if (finding.priority?.actionConfidence === 'low') return 'hypothesis';
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  if (userCaller && userCaller.confidence !== 'high') return 'hypothesis';
  const proofLevel = finding.proofLevel ?? proofLevelFromExtra(finding);
  if (proofLevel === 'heuristic' || proofLevel === 'trace-only') return 'hypothesis';
  if (proofLevel === 'unknown' && finding.confidence !== 'high') return 'rerun';
  return 'actionable';
}

export function proofLevelFromExtra(finding: Finding): string {
  const extra = finding.evidence.extra;
  if (extra && typeof extra === 'object' && !Array.isArray(extra) && 'proofLevel' in extra) {
    const proofLevel = Reflect.get(extra, 'proofLevel');
    if (typeof proofLevel === 'string') return proofLevel;
  }
  return 'unknown';
}

function appendFindingDetail(
  lines: string[],
  finding: Finding,
  position: number,
  report: LanternaReport,
): void {
  lines.push(`## Finding ${position} — ${finding.id}`);
  lines.push('');
  lines.push(`- title: ${finding.title}`);
  lines.push(`- location: ${preferredLocationWithFallback(finding)}`);
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  if (userCaller) lines.push(`- user_caller: ${formatUserCallerCompact(userCaller)}`);
  const candidateCallers = candidateCallersFromEvidenceExtra(finding.evidence.extra);
  if (candidateCallers.length > 0) {
    lines.push(`- candidate_callers: ${candidateCallers.map(formatUserCallerCompact).join('; ')}`);
  }
  const correlatedAllocator = correlatedAllocatorFromEvidenceExtra(finding.evidence.extra);
  if (correlatedAllocator) {
    lines.push(
      `- correlated_allocator: ${frameLabel(correlatedAllocator)} at ${frameLocation(correlatedAllocator)}${basisSuffix(correlatedAllocator.basis)}${userCallerSuffix(correlatedAllocator.userCaller)}`,
    );
  }
  const entryFrame = entryFrameFromEvidenceExtra(finding.evidence.extra);
  if (entryFrame) {
    lines.push(`- entry_frame: ${frameLabel(entryFrame)} at ${frameLocation(entryFrame)}`);
  }
  const userStack = cpuUserStackForFinding(finding, report);
  if (userStack) lines.push(`- user_stack: ${userStack}`);
  lines.push(`- observed: ${formatMeasurements(finding.measurements?.observed)}`);
  lines.push(`- thresholds: ${formatMeasurements(finding.measurements?.thresholds)}`);
  lines.push(`- impact: ${formatImpact(finding)}`);
  lines.push(`- why: ${finding.why}`);
  lines.push(`- suggestion: ${finding.suggestion}`);
  lines.push(`- remediation: ${formatRemediation(finding.remediation)}`);
}
