import type {
  AsyncCpuAttributionEntry,
  AsyncHotFile,
  AsyncProfileReport,
  AsyncStackFrameReport,
  AsyncTopOperation,
  Finding,
  LanternaReport,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import { formatCommand, formatMs, formatPct } from './formatting.js';
import type { RenderableFormat, ReportRenderer } from './types.js';

type Frame = {
  function?: string;
  file: string;
  line: number;
  source?: { file: string; line: number };
};

export class AgentReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'agent';

  render(report: LanternaReport): string {
    const findings = report.findings ?? [];
    const lines: string[] = [];
    appendFrontmatter(lines, report);
    lines.push('');
    appendFindings(lines, findings);
    lines.push('');
    appendKindReview(lines, report);
    lines.push('');
    appendFilesToReadFirst(lines, report);
    lines.push('');
    appendNextCommands(lines, report);
    return `${lines.join('\n').trimEnd()}\n`;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter — capture metadata + signal gate consolidated as scalars.
// ---------------------------------------------------------------------------

function appendFrontmatter(lines: string[], report: LanternaReport): void {
  const meta = report.meta;
  const integrity = meta?.captureIntegrity;
  const sourceMaps = integrity?.sourceMaps;
  const blockingCaveats = blockingIntegrityCaveats(report);
  const degradingCaveats = degradingSignalCaveats(report);

  lines.push('---');
  lines.push(`mode: ${yamlScalar(meta?.mode ?? 'unknown')}`);
  lines.push(`pid: ${yamlScalar(meta?.pid)}`);
  lines.push(`command: ${yamlScalar(formatCommand(meta?.command))}`);
  lines.push(`duration_ms: ${yamlScalar(meta?.durationMs)}`);
  lines.push(`cwd: ${yamlScalar(meta?.cwd ?? 'unknown')}`);
  lines.push(`kinds: ${yamlInlineList(meta?.profileKinds ?? [])}`);
  lines.push(`lanterna_version: ${yamlScalar(meta?.lanternaVersion ?? 'unknown')}`);
  lines.push(`cpu_quality: ${yamlScalar(report.profiles?.cpu?.quality?.confidence ?? 'absent')}`);
  lines.push(`memory_signal: ${yamlScalar(memorySignalLabel(report.profiles?.memory))}`);
  lines.push(
    `async_quality: ${yamlScalar(report.profiles?.async?.quality?.confidence ?? 'absent')}`,
  );
  lines.push(`integrity: ${yamlScalar(integrityLabel(integrity, blockingCaveats))}`);
  if (sourceMaps?.enabled) {
    lines.push(`sourcemap_coverage: ${formatRatio01(sourceMaps.coverage)}`);
    lines.push(`sourcemap_maps_loaded: ${yamlScalar(sourceMaps.mapsLoaded)}`);
  } else {
    lines.push('sourcemap_coverage: null');
  }
  lines.push(`blocking_caveats: ${yamlInlineList(blockingCaveats)}`);
  lines.push(`degrading_caveats: ${yamlInlineList(degradingCaveats)}`);
  lines.push('---');
}

function memorySignalLabel(memory: { memoryUsage?: { available?: boolean } } | undefined): string {
  if (!memory) return 'absent';
  const usage = memory.memoryUsage;
  if (usage?.available === false) return 'usage-unavailable';
  return 'present';
}

function integrityLabel(
  integrity: LanternaReport['meta']['captureIntegrity'] | undefined,
  blockingCaveats: readonly string[],
): string {
  if (!integrity) return 'unknown';
  if (blockingCaveats.length === 0) return 'ok';
  return 'degraded';
}

// ---------------------------------------------------------------------------
// Findings — table summary + per-finding detail block.
// ---------------------------------------------------------------------------

function appendFindings(lines: string[], findings: Finding[]): void {
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
    appendFindingDetail(lines, finding, index + 1);
    if (index < findings.length - 1) lines.push('');
  });
}

function appendFindingDetail(lines: string[], finding: Finding, position: number): void {
  lines.push(`## Finding ${position} — ${finding.id}`);
  lines.push('');
  lines.push(`- title: ${finding.title}`);
  lines.push(`- location: ${preferredLocationWithFallback(finding)}`);
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  if (userCaller) lines.push(`- user_caller: ${formatUserCallerCompact(userCaller)}`);
  lines.push(`- observed: ${formatMeasurements(finding.measurements?.observed)}`);
  lines.push(`- thresholds: ${formatMeasurements(finding.measurements?.thresholds)}`);
  lines.push(`- impact: ${formatImpact(finding)}`);
  lines.push(`- why: ${finding.why}`);
  lines.push(`- suggestion: ${finding.suggestion}`);
  lines.push(`- remediation: ${formatRemediation(finding.remediation)}`);
}

// ---------------------------------------------------------------------------
// Kind Review — one block per declared kind, tables for repeated entities.
// ---------------------------------------------------------------------------

function appendKindReview(lines: string[], report: LanternaReport): void {
  const kinds = report.meta?.profileKinds ?? [];
  if (kinds.length === 0) {
    lines.push('## Kind Review');
    lines.push('');
    lines.push('_no profile kinds declared_');
    return;
  }
  kinds.forEach((kind, index) => {
    if (index > 0) lines.push('');
    lines.push(`## Kind Review — ${kind}`);
    lines.push('');
    switch (kind) {
      case 'cpu':
        appendCpuKindReview(lines, report);
        break;
      case 'memory':
        appendMemoryKindReview(lines, report);
        break;
      case 'async':
        appendAsyncKindReview(lines, report);
        break;
      default:
        lines.push(
          '_custom kind: inspect the declared profile kind and report shape without assuming a built-in section key_',
        );
    }
  });
}

function appendCpuKindReview(lines: string[], report: LanternaReport): void {
  const cpu = report.profiles?.cpu;
  if (!cpu) {
    lines.push('_section absent_');
    return;
  }
  lines.push(`- quality: ${cpu.quality?.confidence ?? 'unknown'}`);
  if (cpu.summary?.topUserHotspot) {
    lines.push(
      `- top_user_hotspot: ${frameLabel(cpu.summary.topUserHotspot)} at ${frameLocation(cpu.summary.topUserHotspot)}`,
    );
  }
  const hotspots = (cpu.hotspots ?? []).slice(0, 5);
  if (hotspots.length > 0) {
    lines.push('- hotspots:');
    appendIndentedTable(
      lines,
      ['#', 'function', 'location', 'self%', 'total%', 'user_caller'],
      hotspots.map((h, i) => [
        String(i + 1),
        h.function ?? '—',
        frameLocation(h),
        formatPct(h.selfPct),
        formatPct(h.totalPct),
        userCallerCell(h.userCaller),
      ]),
    );
  }
  const stacks = (cpu.hotStacks ?? []).slice(0, 3);
  if (stacks.length > 0) {
    lines.push('- hot_stacks:');
    appendIndentedTable(
      lines,
      ['#', 'anchor', 'location', 'weight%'],
      stacks.map((stack, i) => {
        const frame = stack.frames.find((f) => Boolean(f.source)) ?? stack.frames[0];
        return [
          String(i + 1),
          frame?.function ?? '—',
          frame ? frameLocation(frame) : '—',
          formatPct(stack.weightPct),
        ];
      }),
    );
  }
  const clusters = (cpu.hotStackClusters ?? []).slice(0, 3);
  if (clusters.length > 0) {
    lines.push('- hot_stack_clusters:');
    appendIndentedTable(
      lines,
      ['#', 'anchor', 'location', 'weight%'],
      clusters.map((cluster, i) => [
        String(i + 1),
        cluster.anchor.function ?? '—',
        frameLocation(cluster.anchor),
        formatPct(cluster.weightPct),
      ]),
    );
  }
}

function appendMemoryKindReview(lines: string[], report: LanternaReport): void {
  const memory = report.profiles?.memory;
  if (!memory) {
    lines.push('_section absent_');
    return;
  }
  const usage = memory.memoryUsage;
  lines.push(
    `- memory_usage: ${
      usage?.available
        ? `${usage.sampleCount} samples every ${formatMs(usage.sampleIntervalMs)}`
        : 'unavailable'
    }`,
  );
  if (memory.summary?.topAllocator) {
    lines.push(
      `- top_allocator: ${frameLabel(memory.summary.topAllocator)} at ${frameLocation(memory.summary.topAllocator)}${userCallerSuffix(memory.summary.topAllocator.userCaller)}`,
    );
  }
  const allocators = (memory.hotAllocators ?? []).slice(0, 5);
  if (allocators.length > 0) {
    lines.push('- allocators:');
    appendIndentedTable(
      lines,
      ['#', 'function', 'location', 'self%', 'total%', 'user_caller'],
      allocators.map((a, i) => [
        String(i + 1),
        a.function ?? '—',
        frameLocation(a),
        formatPct(a.selfPct),
        formatPct(a.totalPct),
        userCallerCell(a.userCaller),
      ]),
    );
  }
  const snapshot = memory.heapSnapshotAnalysis;
  if (snapshot) {
    lines.push(`- heap_snapshot: ${snapshot.available ? 'available' : 'unavailable'}`);
    if (snapshot.summary?.topGrowingConstructor) {
      lines.push(`- top_growing_constructor: ${snapshot.summary.topGrowingConstructor}`);
    }
    if ((snapshot.warnings ?? []).length > 0) {
      lines.push(`- heap_snapshot_warnings: ${snapshot.warnings.join('; ')}`);
    }
  }
}

function appendAsyncKindReview(lines: string[], report: LanternaReport): void {
  const asyncProfile = report.profiles?.async;
  if (!asyncProfile) {
    lines.push('_section absent_');
    return;
  }
  lines.push(`- quality: ${asyncProfile.quality?.confidence ?? 'unknown'}`);
  lines.push(
    `- summary: ${asyncProfile.summary.available ? 'available' : 'unavailable'} — ${asyncProfile.summary.totalOperations} ops, ${asyncProfile.summary.recordsDropped} dropped`,
  );
  if (asyncProfile.summary.topAsyncHotFile) {
    lines.push(
      `- top_async_hot_file: ${frameLabel(asyncProfile.summary.topAsyncHotFile)} at ${frameLocation(asyncProfile.summary.topAsyncHotFile)}${userCallerSuffix(asyncProfile.summary.topAsyncHotFile.userCaller)}`,
    );
  }
  const ops = (asyncProfile.topOperations ?? []).slice(0, 5);
  if (ops.length > 0) {
    lines.push('- top_operations:');
    appendIndentedTable(
      lines,
      ['#', 'kind', 'asyncId', 'location', 'duration_ms', 'user_caller'],
      ops.map((op, i) => {
        const frame = preferredAsyncOperationFrame(op);
        return [
          String(i + 1),
          op.kind,
          String(op.asyncId),
          frame ? frameLocation(frame) : '—',
          formatScalarOrDash(op.durationMs),
          userCallerCell(op.userCaller),
        ];
      }),
    );
  }
  const hotFiles = (asyncProfile.hotFiles ?? []).slice(0, 5);
  if (hotFiles.length > 0) {
    lines.push('- hot_files:');
    appendIndentedTable(
      lines,
      ['#', 'function', 'location', 'cpu%', 'user_caller'],
      hotFiles.map((hf, i) => [
        String(i + 1),
        hf.primaryFrame.function ?? '—',
        frameLocation(hf.primaryFrame),
        formatPct(hf.cpuPct),
        userCallerCell(hf.userCaller),
      ]),
    );
  }
  const chains = (asyncProfile.cpuAttribution?.topChains ?? []).slice(0, 5);
  if (chains.length > 0) {
    lines.push('- cpu_attribution:');
    appendIndentedTable(
      lines,
      ['#', 'root_kind', 'location', 'cpu%', 'user_caller'],
      chains.map((chain, i) => {
        const frame = chain.executionFrame ?? chain.rootFrame;
        return [
          String(i + 1),
          chain.rootKind,
          frame ? frameLocation(frame) : '—',
          formatPct(chain.cpuPct),
          userCallerCell(chain.userCaller),
        ];
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Files To Read First + Next Commands.
// ---------------------------------------------------------------------------

function appendFilesToReadFirst(lines: string[], report: LanternaReport): void {
  lines.push('## Files To Read First');
  lines.push('');
  const files = dedupe([
    ...(report.findings ?? []).map(preferredFile).filter(isNonEmpty),
    ...aggregateFilesToRead(report),
  ]);
  if (files.length === 0) {
    lines.push('_no editable user source files identified from findings or aggregates_');
    return;
  }
  files.forEach((file, index) => {
    lines.push(`${index + 1}. \`${escapeBackticks(file)}\``);
  });
}

function appendNextCommands(lines: string[], report: LanternaReport): void {
  lines.push('## Next Commands');
  lines.push('');
  if (!hasInsufficientSignal(report)) {
    lines.push('_no rerun required by report signal_');
    return;
  }
  const command = report.meta?.command;
  const duration = recommendedDuration(report);
  if (command && command.length > 0 && report.meta?.mode === 'spawn') {
    lines.push(
      `- \`lanterna run --duration ${duration} --output report.json -- ${escapeBackticks(formatCommand(command))}\``,
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
  lines.push('_rerun recommended, but report does not contain enough launch context_');
}

// ---------------------------------------------------------------------------
// Decision logic, signal gates (kept identical to previous renderer).
// ---------------------------------------------------------------------------

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
  if (report.profiles?.memory?.memoryUsage?.available === false) {
    caveats.push('memory usage series unavailable');
  }
  const heapSnapshotWarnings = report.profiles?.memory?.heapSnapshotAnalysis?.warnings ?? [];
  if (heapSnapshotWarnings.length > 0) {
    caveats.push(`heap snapshot warnings: ${heapSnapshotWarnings.join('; ')}`);
  }
  const asyncProfile = report.profiles?.async;
  if (asyncProfile?.quality?.confidence === 'low') caveats.push('async confidence low');
  if (asyncProfile?.summary?.available === false) caveats.push('async summary unavailable');
  if ((asyncProfile?.quality?.recordsDropped ?? 0) > 0) {
    caveats.push(`${asyncProfile?.quality?.recordsDropped ?? 0} async records dropped`);
  }
  if (sourceMaps?.enabled && sourceMaps.coverage < 0.7) {
    caveats.push('source-map coverage below 70%');
  }
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
    (report.findings ?? []).some((finding) => decisionForFinding(finding) === 'rerun')
  );
}

function decisionForFinding(finding: Finding): 'actionable' | 'hypothesis' | 'rerun' {
  if (finding.confidence === 'low') return 'hypothesis';
  if (finding.priority?.actionConfidence === 'low') return 'hypothesis';
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  if (userCaller && userCaller.confidence !== 'high') return 'hypothesis';
  const proofLevel = finding.proofLevel ?? proofLevelFromExtra(finding);
  if (proofLevel === 'heuristic' || proofLevel === 'trace-only') return 'hypothesis';
  if (proofLevel === 'unknown' && finding.confidence !== 'high') return 'rerun';
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

function userCallerFromEvidenceExtra(extra: unknown): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}

// ---------------------------------------------------------------------------
// Location, files, frames helpers.
// ---------------------------------------------------------------------------

function preferredLocation(finding: Finding): string {
  if (finding.evidence.source) {
    return `${finding.evidence.source.file}:${finding.evidence.source.line}`;
  }
  return `${finding.evidence.file}:${finding.evidence.line}`;
}

function preferredLocationWithFallback(finding: Finding): string {
  const source = finding.evidence.source;
  const generated = `${finding.evidence.file}:${finding.evidence.line}`;
  if (source) return `${source.file}:${source.line} (fallback ${generated})`;
  return generated;
}

function frameLocation(frame: Frame): string {
  if (frame.source) return `${frame.source.file}:${frame.source.line}`;
  return `${frame.file}:${frame.line}`;
}

function frameLabel(frame: Frame): string {
  return frame.function ?? '—';
}

function userCallerCell(caller: UserCallerAttribution | undefined): string {
  if (!caller) return '—';
  return `${frameLocation(caller)} (${caller.confidence})`;
}

function userCallerSuffix(caller: UserCallerAttribution | undefined): string {
  if (!caller) return '';
  return ` — user_caller ${formatUserCallerCompact(caller)}`;
}

function formatUserCallerCompact(caller: UserCallerAttribution): string {
  return `${caller.function ?? '—'} at ${frameLocation(caller)} (${caller.confidence}, ${caller.basis}, support ${formatPct(caller.supportPct)})`;
}

function preferredFile(finding: Finding): string | undefined {
  const evidenceFile = preferredEditableFileFromFrame(finding.evidence);
  if (evidenceFile) return evidenceFile;
  const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
  return preferredEditableFileFromFrame(userCaller);
}

function aggregateFilesToRead(report: LanternaReport): string[] {
  const files: string[] = [];
  const cpu = report.profiles?.cpu;
  if (cpu) {
    pushEditableFrameFile(files, cpu.summary?.topUserHotspot);
    for (const hotspot of cpu.hotspots ?? []) {
      pushEditableFrameFile(files, hotspot);
      pushEditableFrameFile(files, hotspot.userCaller);
    }
    for (const stack of cpu.hotStacks ?? []) {
      for (const frame of stack.frames) pushEditableFrameFile(files, frame);
    }
    for (const cluster of cpu.hotStackClusters ?? []) {
      pushEditableFrameFile(files, cluster.anchor);
    }
  }
  const memory = report.profiles?.memory;
  if (memory) {
    pushEditableFrameFile(files, memory.summary?.topAllocator);
    pushEditableFrameFile(files, memory.summary?.topAllocator?.userCaller);
    for (const allocator of memory.hotAllocators ?? []) {
      pushEditableFrameFile(files, allocator);
      pushEditableFrameFile(files, allocator.userCaller);
    }
  }
  const asyncProfile = report.profiles?.async;
  if (asyncProfile) collectAsyncFiles(files, asyncProfile);
  return dedupe(files);
}

function collectAsyncFiles(files: string[], asyncProfile: AsyncProfileReport): void {
  pushEditableFrameFile(files, asyncProfile.summary.topAsyncHotFile);
  pushEditableFrameFile(files, asyncProfile.summary.topAsyncHotFile?.userCaller);
  for (const operation of asyncProfile.topOperations ?? []) {
    pushEditableFrameFile(files, operation.userCaller);
    for (const frame of asyncOperationFrames(operation)) pushEditableFrameFile(files, frame);
  }
  for (const hotFile of asyncProfile.hotFiles ?? []) {
    pushEditableFrameFile(files, hotFile.primaryFrame);
    pushEditableFrameFile(files, hotFile.userCaller);
  }
  for (const chain of asyncProfile.cpuAttribution?.topChains ?? []) {
    pushEditableFrameFile(files, chain.rootFrame);
    pushEditableFrameFile(files, chain.executionFrame);
    pushEditableFrameFile(files, chain.userCaller);
  }
}

function pushEditableFrameFile(files: string[], frame: Frame | undefined): void {
  const file = preferredEditableFileFromFrame(frame);
  if (file) files.push(file);
}

function preferredEditableFileFromFrame(frame: Frame | undefined): string | undefined {
  if (!frame) return undefined;
  if (frame.source) {
    return isEditableUserFile(frame.source.file) ? frame.source.file : undefined;
  }
  return isEditableUserFile(frame.file) ? frame.file : undefined;
}

function preferredAsyncOperationFrame(op: AsyncTopOperation): AsyncStackFrameReport | undefined {
  return (
    op.primaryFrame ??
    op.awaitFrame ??
    op.executionFrame ??
    op.cdpAsyncContextFrame ??
    op.initFrame ??
    op.creationFrame ??
    op.promiseRegistrationFrame ??
    op.promiseHandlerFrame
  );
}

function asyncOperationFrames(op: AsyncTopOperation): AsyncStackFrameReport[] {
  return [
    op.initFrame,
    op.primaryFrame,
    op.awaitFrame,
    op.executionFrame,
    op.cdpAsyncContextFrame,
    op.creationFrame,
    op.promiseRegistrationFrame,
    op.promiseHandlerFrame,
    ...op.initStack,
  ].filter((frame): frame is AsyncStackFrameReport => Boolean(frame));
}

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------

function formatImpact(finding: Finding): string {
  const impact = finding.priority?.impactEstimateMs;
  if (typeof impact === 'number' && Number.isFinite(impact)) return formatMs(impact);
  return `${formatPct(finding.evidence.selfPct)} self`;
}

function formatMeasurements(values: Record<string, number> | undefined): string {
  if (!values || Object.keys(values).length === 0) return 'none';
  return Object.entries(values)
    .map(([key, value]) => `${key}=${formatRawNumber(value)}`)
    .join(' ');
}

function formatRemediation(remediation: Finding['remediation']): string {
  if (!remediation) return 'none';
  const entries = Object.entries(remediation)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => (key === 'kind' ? `kind=${String(value)}` : `${key}=${String(value)}`));
  return entries.join(' ');
}

function formatScalarOrDash(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return formatRawNumber(value);
}

function formatRawNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatRatio01(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'null';
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
  return !isDependencyOrRuntimePath(value) && !isVirtualSourcePath(value);
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

function isVirtualSourcePath(file: string): boolean {
  return (
    file.startsWith('webpack://') ||
    file.startsWith('vite:/') ||
    file.startsWith('vite://') ||
    file.startsWith('rollup://') ||
    file.startsWith('parcel://')
  );
}

function escapeBackticks(value: string): string {
  return value.replaceAll('`', '\\`');
}

// ---------------------------------------------------------------------------
// YAML + table renderers.
// ---------------------------------------------------------------------------

function yamlScalar(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return formatRawNumber(value);
  }
  if (typeof value === 'boolean') return String(value);
  return yamlString(value);
}

function yamlString(value: string): string {
  if (value === '') return '""';
  if (/^[A-Za-z0-9_./@:-]+$/.test(value) && !/^(true|false|null|~|yes|no|on|off)$/i.test(value)) {
    // Plain scalar safe — no special chars, not a YAML reserved keyword.
    if (!value.startsWith('-') && !/^\d/.test(value)) return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function yamlInlineList(values: readonly string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map((v) => yamlString(v)).join(', ')}]`;
}

function appendTable(lines: string[], headers: string[], rows: string[][]): void {
  const escaped = rows.map((row) => row.map(escapeCell));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...escaped.map((row) => (row[i] ?? '').length)),
  );
  const widthAt = (i: number): number => widths[i] ?? 0;
  lines.push(`| ${headers.map((h, i) => pad(h, widthAt(i))).join(' | ')} |`);
  lines.push(`| ${widths.map((w) => '-'.repeat(Math.max(3, w))).join(' | ')} |`);
  for (const row of escaped) {
    lines.push(`| ${row.map((cell, i) => pad(cell ?? '', widthAt(i))).join(' | ')} |`);
  }
}

function appendIndentedTable(lines: string[], headers: string[], rows: string[][]): void {
  const buffer: string[] = [];
  appendTable(buffer, headers, rows);
  for (const line of buffer) lines.push(`  ${line}`);
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}
