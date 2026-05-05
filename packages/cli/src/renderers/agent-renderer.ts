import type { Finding, LanternaReport, UserCallerAttribution } from '@lanterna-profiler/core';
import {
  formatCommand,
  formatFrameLocation,
  formatMs,
  formatPct,
  formatRatio,
  formatUserCaller,
} from './formatting.js';
import type { RenderableFormat, ReportRenderer } from './types.js';

export class AgentReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'agent';

  render(report: LanternaReport): string {
    const lines: string[] = [];
    lines.push('# Lanterna Agent Report');
    lines.push('');
    this.renderCapture(lines, report);
    lines.push('');
    this.renderSignalGate(lines, report);
    lines.push('');
    this.renderActionQueue(lines, report.findings ?? []);
    lines.push('');
    this.renderEvidencePack(lines, report.findings ?? []);
    lines.push('');
    this.renderFilesToReadFirst(lines, report.findings ?? []);
    lines.push('');
    this.renderDecisionRules(lines, report);
    lines.push('');
    this.renderNextCommands(lines, report);
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private renderCapture(lines: string[], report: LanternaReport): void {
    const meta = report.meta;
    const sourceMaps = meta?.captureIntegrity?.sourceMaps;
    lines.push('## Capture');
    lines.push('');
    lines.push(`- Mode: ${meta?.mode ?? 'unknown'}`);
    lines.push(`- Command: \`${escapeBackticks(formatCommand(meta?.command))}\``);
    lines.push(`- PID: ${formatNumber(meta?.pid)}`);
    lines.push(`- Duration: ${formatMs(meta?.durationMs)}`);
    lines.push(`- CWD: \`${escapeBackticks(meta?.cwd ?? 'unknown')}\``);
    lines.push(`- Kinds: ${formatList(meta?.profileKinds)}`);
    lines.push(`- Lanterna version: ${meta?.lanternaVersion ?? 'unknown'}`);
    if (sourceMaps?.enabled) {
      lines.push(
        `- Source-map coverage: ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded)`,
      );
    } else {
      lines.push('- Source-map coverage: disabled or unavailable');
    }
  }

  private renderSignalGate(lines: string[], report: LanternaReport): void {
    const cpuQuality = report.profiles?.cpu?.quality;
    const integrity = report.meta?.captureIntegrity;
    const blockingCaveats = blockingIntegrityCaveats(report);
    const degradingCaveats = degradingSignalCaveats(report);
    lines.push('## Signal Gate');
    lines.push('');
    lines.push(`- CPU quality: ${cpuQuality?.confidence ?? 'absent'}`);
    lines.push(`- Integrity: ${formatIntegrity(integrity, blockingCaveats)}`);
    lines.push(`- Blocking caveats: ${formatCaveats(blockingCaveats)}`);
    lines.push(`- Degrading caveats: ${formatCaveats(degradingCaveats)}`);
  }

  private renderActionQueue(lines: string[], findings: Finding[]): void {
    lines.push('## Action Queue');
    lines.push('');
    if (findings.length === 0) {
      lines.push('No findings.');
      return;
    }
    findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.title}`);
      lines.push('');
      lines.push(`- ID: ${finding.id}`);
      lines.push(`- Kind: ${finding.profileKind}`);
      lines.push(`- Priority: ${formatNumber(finding.priority?.score)}`);
      lines.push(`- Action confidence: ${finding.priority?.actionConfidence ?? 'unknown'}`);
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Confidence: ${finding.confidence ?? 'unknown'}`);
      lines.push(`- Proof level: ${finding.proofLevel ?? proofLevelFromExtra(finding)}`);
      lines.push(`- Impact: ${formatImpact(finding)}`);
      lines.push(`- Source: \`${escapeBackticks(preferredLocation(finding))}\``);
      lines.push(`- Generated fallback: \`${escapeBackticks(generatedLocation(finding))}\``);
      const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
      if (userCaller) {
        lines.push(`- User caller: ${formatUserCaller(userCaller)}`);
      }
      lines.push('');
    });
  }

  private renderEvidencePack(lines: string[], findings: Finding[]): void {
    lines.push('## Evidence Pack');
    lines.push('');
    if (findings.length === 0) {
      lines.push('No evidence items.');
      return;
    }
    findings.forEach((finding, index) => {
      lines.push(`### ${index + 1}. ${finding.id}`);
      lines.push('');
      lines.push(`- Observed: ${formatMeasurements(finding.measurements?.observed)}`);
      lines.push(`- Thresholds: ${formatMeasurements(finding.measurements?.thresholds)}`);
      lines.push(`- Why: ${finding.why}`);
      lines.push(`- Suggestion: ${finding.suggestion}`);
      lines.push(`- Remediation: ${formatRemediation(finding.remediation)}`);
      lines.push('');
    });
  }

  private renderFilesToReadFirst(lines: string[], findings: Finding[]): void {
    lines.push('## Files To Read First');
    lines.push('');
    const files = dedupe(findings.map((finding) => preferredFile(finding)).filter(isNonEmpty));
    if (files.length === 0) {
      lines.push('No editable user source files identified from findings.');
      return;
    }
    files.forEach((file, index) => {
      lines.push(`${index + 1}. \`${escapeBackticks(file)}\``);
    });
  }

  private renderDecisionRules(lines: string[], report: LanternaReport): void {
    lines.push('## Decision Rules');
    lines.push('');
    const findings = report.findings ?? [];
    if (findings.length === 0) {
      lines.push(
        '- No findings: inspect profile summary or rerun only if the signal gate is degraded.',
      );
      return;
    }
    for (const finding of findings) {
      lines.push(`- ${finding.id}: ${decisionForFinding(finding)}`);
    }
  }

  private renderNextCommands(lines: string[], report: LanternaReport): void {
    lines.push('## Next Commands');
    lines.push('');
    if (!hasInsufficientSignal(report)) {
      lines.push('No rerun required by report signal.');
      return;
    }
    const command = report.meta?.command;
    const duration = recommendedDuration(report);
    if (command && command.length > 0 && report.meta?.mode === 'spawn') {
      lines.push(
        `- \`lanterna run --duration ${duration} --output report.json -- ${escapeBackticks(
          formatCommand(command),
        )}\``,
      );
      lines.push('- `lanterna report report.json --format agent --output report.agent.md`');
      return;
    }
    if (report.meta?.mode === 'attach' && report.meta.pid) {
      lines.push(
        `- \`lanterna attach --pid ${report.meta.pid} --duration ${duration} --output report.json\``,
      );
      lines.push('- `lanterna report report.json --format agent --output report.agent.md`');
      return;
    }
    lines.push(
      '- Rerun recommended, but report does not contain enough launch context for a command.',
    );
  }
}

function formatIntegrity(
  integrity: LanternaReport['meta']['captureIntegrity'] | undefined,
  blockingCaveats: readonly string[],
): string {
  if (!integrity) return 'unknown';
  if (blockingCaveats.length === 0) return 'ok';
  return 'degraded';
}

function blockingIntegrityCaveats(report: LanternaReport): string[] {
  const integrity = report.meta?.captureIntegrity;
  if (!integrity) return ['capture integrity missing'];
  const caveats: string[] = [];
  if (integrity.controlChannelExpected && !integrity.controlChannel) {
    caveats.push('control channel unavailable');
  }
  return caveats;
}

function degradingSignalCaveats(report: LanternaReport): string[] {
  const integrity = report.meta?.captureIntegrity;
  const caveats: string[] = [];
  const sourceMaps = integrity?.sourceMaps;
  if (report.profiles?.cpu?.quality?.confidence === 'low') caveats.push('CPU confidence low');
  if (sourceMaps?.enabled && sourceMaps.coverage < 0.7)
    caveats.push('source-map coverage below 70%');
  if (integrity?.eventLoopTimed === false) caveats.push('event-loop timing unavailable');
  if (integrity?.gcTimed === false) caveats.push('GC timing unavailable');
  if ((integrity?.heartbeatDropped ?? 0) > 0) {
    caveats.push(`${integrity?.heartbeatDropped ?? 0} heartbeat events dropped`);
  }
  return caveats;
}

function hasInsufficientSignal(report: LanternaReport): boolean {
  return (
    blockingIntegrityCaveats(report).length > 0 ||
    degradingSignalCaveats(report).length > 0 ||
    (report.findings ?? []).some((finding) => decisionForFinding(finding) === 'rerun required')
  );
}

function decisionForFinding(finding: Finding): string {
  if (finding.confidence === 'low') return 'hypothesis';
  if (finding.priority?.actionConfidence === 'low') return 'hypothesis';
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  if (userCaller && userCaller.confidence !== 'high') return 'hypothesis';
  const proofLevel = finding.proofLevel ?? proofLevelFromExtra(finding);
  if (proofLevel === 'heuristic' || proofLevel === 'trace-only') return 'hypothesis';
  if (proofLevel === 'unknown' && finding.confidence !== 'high') return 'rerun required';
  return 'actionable';
}

function proofLevelFromExtra(finding: Finding): string {
  const extra = finding.evidence.extra;
  if (extra && typeof extra === 'object' && !Array.isArray(extra) && 'proofLevel' in extra) {
    const value = Reflect.get(extra, 'proofLevel');
    if (typeof value === 'string') return value;
  }
  return 'unknown';
}

function preferredLocation(finding: Finding): string {
  if (finding.evidence.source) {
    return `${finding.evidence.source.file}:${finding.evidence.source.line}`;
  }
  return formatFrameLocation(finding.evidence);
}

function generatedLocation(finding: Finding): string {
  return `${finding.evidence.file}:${finding.evidence.line}`;
}

function preferredFile(finding: Finding): string | undefined {
  const evidenceFile = finding.evidence.source?.file ?? finding.evidence.file;
  if (isEditableUserFile(evidenceFile)) return evidenceFile;
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  const userCallerFile = userCaller?.source?.file ?? userCaller?.file;
  if (isEditableUserFile(userCallerFile)) return userCallerFile;
  return undefined;
}

function formatImpact(finding: Finding): string {
  const impact = finding.priority?.impactEstimateMs;
  if (typeof impact === 'number' && Number.isFinite(impact)) return formatMs(impact);
  return `${formatPct(finding.evidence.selfPct)} self`;
}

function formatMeasurements(values: Record<string, number> | undefined): string {
  if (!values || Object.keys(values).length === 0) return 'none';
  return Object.entries(values)
    .map(([key, value]) => `${key}=${formatRawNumber(value)}`)
    .join(', ');
}

function formatRemediation(remediation: Finding['remediation']): string {
  if (!remediation) return 'none';
  const entries = Object.entries(remediation)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => (key === 'kind' ? String(value) : `${key}=${String(value)}`));
  return entries.join('; ');
}

function formatList(values: readonly string[] | undefined): string {
  if (!values || values.length === 0) return 'none';
  return values.join(', ');
}

function formatCaveats(values: readonly string[]): string {
  if (values.length === 0) return 'none';
  return values.join('; ');
}

function formatNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return formatRawNumber(value);
}

function formatRawNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function recommendedDuration(report: LanternaReport): string {
  const current = report.meta?.durationMs;
  if (typeof current !== 'number' || !Number.isFinite(current)) return '5s';
  return `${Math.max(5, Math.ceil(current / 1000))}s`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEditableUserFile(value: string | undefined): value is string {
  if (!isNonEmpty(value)) return false;
  return !isDependencyOrRuntimePath(value);
}

function isDependencyOrRuntimePath(file: string): boolean {
  return (
    file.startsWith('node:') ||
    file.startsWith('native ') ||
    file === 'native' ||
    file.includes('/node_modules/') ||
    file.includes('/pnpm-store/') ||
    file.includes('/.pnpm/') ||
    file.includes('/caches/pnpm-store/')
  );
}

function escapeBackticks(value: string): string {
  return value.replaceAll('`', '\\`');
}

function userCallerFromEvidenceExtra(extra: unknown): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}
