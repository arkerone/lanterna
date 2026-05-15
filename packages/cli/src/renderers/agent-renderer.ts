import type {
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

type ReadTargetSource = 'finding' | 'cpu' | 'memory' | 'async';
type ReadTargetDecision = 'read-first' | 'inspect-lead' | 'supporting-context';
type ReadTargetReason =
  | 'finding-location'
  | 'generated-output-fallback'
  | 'user-caller'
  | 'dependency-hotspot-caller'
  | 'runtime-hotspot-caller'
  | 'top-cpu-hotspot'
  | 'hot-stack-cluster'
  | 'memory-allocator'
  | 'top-async-hot-file'
  | 'top-async-hot-file-caller'
  | 'long-async-operation'
  | 'long-async-operation-caller'
  | 'async-hot-file'
  | 'async-hot-file-caller'
  | 'async-cpu-attribution-root'
  | 'async-cpu-attribution'
  | 'async-cpu-attribution-caller';

type ReadTarget = {
  location: string;
  file: string;
  generatedOutput: boolean;
  reason: ReadTargetReason;
  source: ReadTargetSource;
  signal: string;
  decision: ReadTargetDecision;
  rank: number;
};

const NON_EDITABLE_RUNTIME_FUNCTIONS = new Set(['init', 'runMicrotasks', 'writeBuffer']);
const MOSTLY_IDLE_CPU_RATIO = 0.9;

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
  lines.push(`rerun_required: ${yamlScalar(hasInsufficientSignal(report))}`);
  if (sourceMaps?.enabled) {
    lines.push(`sourcemap_coverage: ${formatRatio01(sourceMaps.coverage)}`);
    if (sourceMaps.status !== undefined) {
      lines.push(`sourcemap_status: ${yamlScalar(sourceMaps.status)}`);
    }
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
  const candidateCallers = candidateCallersFromEvidenceExtra(finding.evidence.extra);
  if (candidateCallers.length > 0) {
    lines.push(`- candidate_callers: ${candidateCallers.map(formatUserCallerCompact).join('; ')}`);
  }
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
  if (isRenderableReviewFrame(cpu.summary?.topUserHotspot)) {
    lines.push(
      `- top_user_hotspot: ${frameLabel(cpu.summary.topUserHotspot)} at ${frameLocation(cpu.summary.topUserHotspot)}`,
    );
  }
  const hotspots = (cpu.hotspots ?? []).filter(isRenderableReviewFrame).slice(0, 5);
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
  const stackRows = stacks.flatMap((stack, i) => {
    const frame =
      stack.frames.find((f) => Boolean(f.source) && isRenderableReviewFrame(f)) ??
      stack.frames.find(isRenderableReviewFrame);
    if (!frame) return [];
    return [
      [String(i + 1), frame.function ?? '—', frameLocation(frame), formatPct(stack.weightPct)],
    ];
  });
  if (stackRows.length > 0) {
    lines.push('- hot_stacks:');
    appendIndentedTable(lines, ['#', 'anchor', 'location', 'weight%'], stackRows);
  }
  const clusters = (cpu.hotStackClusters ?? [])
    .filter((cluster) => isRenderableReviewFrame(cluster.anchor))
    .slice(0, 3);
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
  if (isRenderableReviewFrame(memory.summary?.topAllocator)) {
    lines.push(
      `- top_allocator: ${frameLabel(memory.summary.topAllocator)} at ${frameLocation(memory.summary.topAllocator)}${userCallerSuffix(memory.summary.topAllocator.userCaller)}`,
    );
  }
  const allocators = (memory.hotAllocators ?? []).filter(isRenderableReviewFrame).slice(0, 5);
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
  if (isRenderableReviewFrame(asyncProfile.summary.topAsyncHotFile)) {
    lines.push(
      `- top_async_hot_file: ${frameLabel(asyncProfile.summary.topAsyncHotFile)} at ${frameLocation(asyncProfile.summary.topAsyncHotFile)}${userCallerSuffix(asyncProfile.summary.topAsyncHotFile.userCaller)}`,
    );
  }
  const operationRows = (asyncProfile.topOperations ?? []).flatMap((op, i) => {
    const frame = preferredAsyncOperationFrame(op);
    if (!isRenderableReviewFrame(frame) && !isRenderableReviewFrame(op.userCaller)) return [];
    return [
      [
        String(i + 1),
        op.kind,
        String(op.asyncId),
        isRenderableReviewFrame(frame) ? frameLocation(frame) : '—',
        formatScalarOrDash(op.durationMs),
        userCallerCell(op.userCaller),
      ],
    ];
  });
  if (operationRows.length > 0) {
    lines.push('- top_operations:');
    appendIndentedTable(
      lines,
      ['#', 'kind', 'asyncId', 'location', 'duration_ms', 'user_caller'],
      operationRows.slice(0, 5),
    );
  }
  const hotFiles = (asyncProfile.hotFiles ?? [])
    .filter((hotFile) => isRenderableReviewFrame(hotFile.primaryFrame))
    .slice(0, 5);
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
  const chainRows = (asyncProfile.cpuAttribution?.topChains ?? []).flatMap((chain, i) => {
    const frame = chain.executionFrame ?? chain.rootFrame;
    if (!isRenderableReviewFrame(frame) && !isRenderableReviewFrame(chain.userCaller)) return [];
    return [
      [
        String(i + 1),
        chain.rootKind,
        isRenderableReviewFrame(frame) ? frameLocation(frame) : '—',
        formatPct(chain.cpuPct),
        userCallerCell(chain.userCaller),
      ],
    ];
  });
  if (chainRows.length > 0) {
    lines.push('- cpu_attribution:');
    appendIndentedTable(
      lines,
      ['#', 'root_kind', 'location', 'cpu%', 'user_caller'],
      chainRows.slice(0, 5),
    );
  }
}

// ---------------------------------------------------------------------------
// Files To Read First.
// ---------------------------------------------------------------------------

function appendFilesToReadFirst(lines: string[], report: LanternaReport): void {
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
  const idleRatio =
    report.profiles?.cpu?.quality?.idleRatio ?? report.profiles?.cpu?.summary?.idleRatio;
  if (
    typeof idleRatio === 'number' &&
    Number.isFinite(idleRatio) &&
    idleRatio >= MOSTLY_IDLE_CPU_RATIO
  ) {
    caveats.push(`CPU profile mostly idle (${formatPct(idleRatio * 100)})`);
  }
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
  if (sourceMaps?.enabled && (sourceMaps.applicable ?? true) && sourceMaps.coverage < 0.7) {
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

function candidateCallersFromEvidenceExtra(extra: unknown): UserCallerAttribution[] {
  if (!extra || typeof extra !== 'object') return [];
  const value = (extra as { candidateCallers?: unknown }).candidateCallers;
  return Array.isArray(value) ? (value as UserCallerAttribution[]) : [];
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
  const stackDistance =
    caller.stackDistance !== undefined ? `, distance ${caller.stackDistance}` : '';
  return `${caller.function ?? '—'} at ${frameLocation(caller)} (${caller.confidence}, ${caller.basis}, support ${formatPct(caller.supportPct)}${stackDistance})`;
}

function collectReadTargets(report: LanternaReport): ReadTarget[] {
  const targets: ReadTarget[] = [];
  collectFindingReadTargets(targets, report.findings ?? []);
  collectAggregateReadTargets(targets, report);
  return dedupeReadTargets(targets)
    .sort((a, b) => a.rank - b.rank || a.location.localeCompare(b.location))
    .slice(0, 10);
}

function collectFindingReadTargets(targets: ReadTarget[], findings: Finding[]): void {
  findings.forEach((finding, index) => {
    const signal = formatImpact(finding);
    const findingDecision = decisionForFinding(finding);
    const evidenceTarget = readTargetFrame(finding.evidence);
    if (evidenceTarget) {
      const findingIsActionable =
        findingDecision === 'actionable' && !evidenceTarget.generatedOutput;
      targets.push({
        ...evidenceTarget,
        reason: evidenceTarget.generatedOutput ? 'generated-output-fallback' : 'finding-location',
        source: 'finding',
        signal,
        decision: findingIsActionable ? 'read-first' : 'inspect-lead',
        rank: findingIsActionable ? index : 100 + index,
      });
      return;
    }
    const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
    const userCallerTarget = readTargetFrame(userCaller);
    if (userCallerTarget) {
      targets.push({
        ...userCallerTarget,
        reason: reasonForExternalUserCaller(finding.evidence),
        source: 'finding',
        signal,
        decision:
          findingDecision === 'actionable' && userCaller?.confidence === 'high'
            ? 'read-first'
            : 'inspect-lead',
        rank:
          findingDecision === 'actionable' && userCaller?.confidence === 'high'
            ? index
            : 100 + index,
      });
    }
    candidateCallersFromEvidenceExtra(finding.evidence.extra)
      .filter((caller) => caller !== userCaller)
      .forEach((caller, candidateIndex) => {
        const target = readTargetFrame(caller);
        if (!target) return;
        targets.push({
          ...target,
          reason: reasonForExternalUserCaller(finding.evidence),
          source: 'finding',
          signal,
          decision:
            caller.stackDistance === 1 && caller.confidence === 'high'
              ? 'inspect-lead'
              : 'supporting-context',
          rank: 150 + index * 10 + candidateIndex,
        });
      });
  });
}

function collectAggregateReadTargets(targets: ReadTarget[], report: LanternaReport): void {
  const cpu = report.profiles?.cpu;
  if (cpu) {
    pushReadTarget(targets, cpu.summary?.topUserHotspot, {
      reason: 'top-cpu-hotspot',
      source: 'cpu',
      signal: signalFromPctFrame(cpu.summary?.topUserHotspot),
      decision: 'inspect-lead',
      rank: 200,
    });
    for (const hotspot of cpu.hotspots ?? []) {
      const userCaller = readTargetFrame(hotspot.userCaller);
      if (userCaller && isExternalOrRuntimeFrame(hotspot)) {
        targets.push({
          ...userCaller,
          reason: reasonForExternalUserCaller(hotspot),
          source: 'cpu',
          signal: signalFromPctFrame(hotspot),
          decision: hotspot.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
          rank: hotspot.userCaller?.confidence === 'high' ? 210 : 230,
        });
      } else {
        pushReadTarget(targets, hotspot, {
          reason: 'top-cpu-hotspot',
          source: 'cpu',
          signal: signalFromPctFrame(hotspot),
          decision: 'inspect-lead',
          rank: 220,
        });
      }
    }
    for (const stack of cpu.hotStacks ?? []) {
      const frame = stack.frames.find((candidate) => Boolean(readTargetFrame(candidate)));
      pushReadTarget(targets, frame, {
        reason: 'hot-stack-cluster',
        source: 'cpu',
        signal: signalFromWeight(stack.weightPct),
        decision: 'supporting-context',
        rank: 240,
      });
    }
    for (const cluster of cpu.hotStackClusters ?? []) {
      pushReadTarget(targets, cluster.anchor, {
        reason: 'hot-stack-cluster',
        source: 'cpu',
        signal: signalFromWeight(cluster.weightPct),
        decision: 'supporting-context',
        rank: 250,
      });
    }
  }
  const memory = report.profiles?.memory;
  if (memory) {
    collectAllocatorReadTarget(targets, memory.summary?.topAllocator, 300);
    for (const allocator of memory.hotAllocators ?? []) {
      collectAllocatorReadTarget(targets, allocator, 310);
    }
  }
  const asyncProfile = report.profiles?.async;
  if (asyncProfile) collectAsyncReadTargets(targets, asyncProfile);
}

function collectAllocatorReadTarget(
  targets: ReadTarget[],
  frame: (Frame & { userCaller?: UserCallerAttribution; selfPct?: number }) | undefined,
  rank: number,
): void {
  if (!frame) return;
  const userCaller = readTargetFrame(frame.userCaller);
  if (userCaller && isExternalOrRuntimeFrame(frame)) {
    targets.push({
      ...userCaller,
      reason: 'memory-allocator',
      source: 'memory',
      signal: signalFromPctFrame(frame),
      decision: frame.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
      rank,
    });
    return;
  }
  pushReadTarget(targets, frame, {
    reason: 'memory-allocator',
    source: 'memory',
    signal: signalFromPctFrame(frame),
    decision: 'inspect-lead',
    rank,
  });
}

function collectAsyncReadTargets(targets: ReadTarget[], asyncProfile: AsyncProfileReport): void {
  collectAsyncFrameReadTarget(targets, asyncProfile.summary.topAsyncHotFile, {
    reason: 'top-async-hot-file',
    signal: signalFromAsyncScore(asyncProfile.summary.topAsyncHotFile),
    rank: 400,
  });
  collectAsyncFrameReadTarget(targets, asyncProfile.summary.topAsyncHotFile?.userCaller, {
    reason: 'top-async-hot-file-caller',
    signal: signalFromAsyncScore(asyncProfile.summary.topAsyncHotFile),
    rank: 410,
  });
  for (const operation of asyncProfile.topOperations ?? []) {
    const userCaller = readTargetFrame(operation.userCaller);
    if (userCaller) {
      targets.push({
        ...userCaller,
        reason: 'long-async-operation-caller',
        source: 'async',
        signal: signalFromDuration(operation.durationMs),
        decision: operation.userCaller?.confidence === 'high' ? 'read-first' : 'inspect-lead',
        rank: 420,
      });
    } else {
      for (const frame of asyncOperationFrames(operation)) {
        if (
          pushReadTarget(targets, frame, {
            reason: 'long-async-operation',
            source: 'async',
            signal: signalFromDuration(operation.durationMs),
            decision: 'inspect-lead',
            rank: 430,
          })
        )
          break;
      }
    }
  }
  for (const hotFile of asyncProfile.hotFiles ?? []) {
    collectAsyncFrameReadTarget(targets, hotFile.primaryFrame, {
      reason: 'async-hot-file',
      signal: signalFromAsyncHotFile(hotFile),
      rank: 440,
    });
    collectAsyncFrameReadTarget(targets, hotFile.userCaller, {
      reason: 'async-hot-file-caller',
      signal: signalFromAsyncHotFile(hotFile),
      rank: 450,
    });
  }
  for (const chain of asyncProfile.cpuAttribution?.topChains ?? []) {
    collectAsyncFrameReadTarget(targets, chain.rootFrame, {
      reason: 'async-cpu-attribution-root',
      signal: signalFromCpuPct(chain.cpuPct),
      rank: 460,
    });
    collectAsyncFrameReadTarget(targets, chain.executionFrame, {
      reason: 'async-cpu-attribution',
      signal: signalFromCpuPct(chain.cpuPct),
      rank: 470,
    });
    collectAsyncFrameReadTarget(targets, chain.userCaller, {
      reason: 'async-cpu-attribution-caller',
      signal: signalFromCpuPct(chain.cpuPct),
      rank: 480,
    });
  }
}

function collectAsyncFrameReadTarget(
  targets: ReadTarget[],
  frame: Frame | undefined,
  attrs: { reason: ReadTargetReason; signal: string; rank: number },
): void {
  pushReadTarget(targets, frame, {
    reason: attrs.reason,
    source: 'async',
    signal: attrs.signal,
    decision: 'inspect-lead',
    rank: attrs.rank,
  });
}

function pushReadTarget(
  targets: ReadTarget[],
  frame: Frame | undefined,
  attrs: Omit<ReadTarget, 'file' | 'location' | 'generatedOutput'>,
): boolean {
  const target = readTargetFrame(frame);
  if (!target) return false;
  targets.push({ ...target, ...attrs });
  return true;
}

function readTargetFrame(
  frame: Frame | undefined,
): Pick<ReadTarget, 'file' | 'location' | 'generatedOutput'> | undefined {
  if (!frame || isPseudoFrameFunction(frame.function)) return undefined;
  if (frame.source && isEditableUserFile(frame.source.file)) {
    return {
      file: frame.source.file,
      location: `${frame.source.file}:${frame.source.line}`,
      generatedOutput: false,
    };
  }
  if (!isEditableUserFile(frame.file)) return undefined;
  return {
    file: frame.file,
    location: `${frame.file}:${frame.line}`,
    generatedOutput: isGeneratedOutputPath(frame.file),
  };
}

function dedupeReadTargets(targets: ReadTarget[]): ReadTarget[] {
  const byLocation = new Map<string, ReadTarget>();
  for (const target of targets) {
    const existing = byLocation.get(target.location);
    if (!existing || compareReadTargetPriority(target, existing) < 0) {
      byLocation.set(target.location, target);
    }
  }
  return [...byLocation.values()];
}

function compareReadTargetPriority(a: ReadTarget, b: ReadTarget): number {
  const decisionDelta = decisionRank(a.decision) - decisionRank(b.decision);
  if (decisionDelta !== 0) return decisionDelta;
  return a.rank - b.rank;
}

function decisionRank(decision: ReadTargetDecision): number {
  switch (decision) {
    case 'read-first':
      return 0;
    case 'inspect-lead':
      return 1;
    case 'supporting-context':
      return 2;
  }
}

function formatReadTargetReason(reason: ReadTargetReason): string {
  switch (reason) {
    case 'finding-location':
      return 'finding location';
    case 'generated-output-fallback':
      return 'generated output fallback';
    case 'user-caller':
      return 'user caller';
    case 'dependency-hotspot-caller':
      return 'user caller for dependency hotspot';
    case 'runtime-hotspot-caller':
      return 'user caller for runtime hotspot';
    case 'top-cpu-hotspot':
      return 'top CPU hotspot';
    case 'hot-stack-cluster':
      return 'hot stack cluster';
    case 'memory-allocator':
      return 'memory allocator';
    case 'top-async-hot-file':
      return 'top async hot file';
    case 'top-async-hot-file-caller':
      return 'top async hot file caller';
    case 'long-async-operation':
      return 'long async operation';
    case 'long-async-operation-caller':
      return 'long async operation caller';
    case 'async-hot-file':
      return 'async hot file';
    case 'async-hot-file-caller':
      return 'async hot file caller';
    case 'async-cpu-attribution-root':
      return 'async CPU attribution root';
    case 'async-cpu-attribution':
      return 'async CPU attribution';
    case 'async-cpu-attribution-caller':
      return 'async CPU attribution caller';
  }
}

function reasonForExternalUserCaller(frame: Frame): ReadTargetReason {
  if (isDependencyPath(frame.file)) return 'dependency-hotspot-caller';
  if (isExternalOrRuntimeFrame(frame)) return 'runtime-hotspot-caller';
  return 'user-caller';
}

function isExternalOrRuntimeFrame(frame: Frame): boolean {
  return (
    isDependencyOrRuntimePath(frame.file) ||
    isVirtualSourcePath(frame.file) ||
    isPseudoFile(frame.file) ||
    isPseudoFrameFunction(frame.function)
  );
}

function isRenderableReviewFrame(frame: Frame | undefined): frame is Frame {
  if (!frame) return false;
  return !isPseudoFile(frame.file) && !isPseudoFrameFunction(frame.function);
}

function signalFromPctFrame(frame: (Frame & { selfPct?: number }) | undefined): string {
  if (typeof frame?.selfPct === 'number' && Number.isFinite(frame.selfPct)) {
    return `${formatPct(frame.selfPct)} self`;
  }
  return '—';
}

function signalFromWeight(weightPct: number | undefined): string {
  if (typeof weightPct === 'number' && Number.isFinite(weightPct)) {
    return `${formatPct(weightPct)} stack weight`;
  }
  return '—';
}

function signalFromDuration(durationMs: number | undefined): string {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) return formatMs(durationMs);
  return '—';
}

function signalFromCpuPct(cpuPct: number | undefined): string {
  if (typeof cpuPct === 'number' && Number.isFinite(cpuPct)) return `${formatPct(cpuPct)} CPU`;
  return '—';
}

function signalFromAsyncScore(frame: (Frame & { score?: number }) | undefined): string {
  if (typeof frame?.score === 'number' && Number.isFinite(frame.score)) {
    return `score ${formatRawNumber(frame.score)}`;
  }
  return '—';
}

function signalFromAsyncHotFile(hotFile: {
  cpuPct?: number;
  totalDurationMs?: number;
  score?: number;
}): string {
  if (typeof hotFile.cpuPct === 'number' && Number.isFinite(hotFile.cpuPct)) {
    return `${formatPct(hotFile.cpuPct)} CPU`;
  }
  if (typeof hotFile.totalDurationMs === 'number' && Number.isFinite(hotFile.totalDurationMs)) {
    return `${formatMs(hotFile.totalDurationMs)} total`;
  }
  if (typeof hotFile.score === 'number' && Number.isFinite(hotFile.score)) {
    return `score ${formatRawNumber(hotFile.score)}`;
  }
  return '—';
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

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isEditableUserFile(value: string | undefined): value is string {
  if (!isNonEmpty(value)) return false;
  return !isPseudoFile(value) && !isDependencyOrRuntimePath(value) && !isVirtualSourcePath(value);
}

function isGeneratedOutputPath(file: string): boolean {
  const normalized = file.replaceAll('\\', '/');
  return /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.vite)(\/|$)/.test(normalized);
}

function isPseudoFile(file: string): boolean {
  const trimmed = normalizeFrameLabel(file);
  return (
    isMissingFrameLabel(trimmed) ||
    isParenthesizedRuntimeLabel(trimmed) ||
    isAngleBracketRuntimeLabel(trimmed)
  );
}

function isPseudoFrameFunction(value: string | undefined): boolean {
  const label = normalizeFrameLabel(value);
  if (isMissingFrameLabel(label)) return false;
  return isParenthesizedRuntimeLabel(label) || NON_EDITABLE_RUNTIME_FUNCTIONS.has(label);
}

function normalizeFrameLabel(value: string | undefined): string {
  return value?.trim() ?? '';
}

function isMissingFrameLabel(value: string): boolean {
  return value.length === 0;
}

function isParenthesizedRuntimeLabel(value: string): boolean {
  return value.startsWith('(') && value.endsWith(')');
}

function isAngleBracketRuntimeLabel(value: string): boolean {
  return value.startsWith('<') && value.endsWith('>');
}

function isDependencyOrRuntimePath(file: string): boolean {
  return (
    isDependencyPath(file) ||
    file.startsWith('node:') ||
    file.startsWith('native ') ||
    file === 'native'
  );
}

function isDependencyPath(file: string): boolean {
  return (
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
