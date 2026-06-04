import type { LanternaReport } from '@lanterna-profiler/core';
import { formatMs, formatPct } from '../formatting.js';
import {
  frameLabel,
  frameLocation,
  isRenderableReviewFrame,
  sameFrameLocation,
  userCallerCell,
  userCallerSuffix,
} from './frames.js';
import { appendIndentedTable } from './markdown.js';
import { formatScalarOrDash, preferredAsyncOperationFrame } from './values.js';

export function appendKindReview(lines: string[], report: LanternaReport): void {
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
  if (isRenderableReviewFrame(cpu.summary?.topCpuCulprit)) {
    lines.push(
      `- top_cpu_culprit: ${frameLabel(cpu.summary.topCpuCulprit)} at ${frameLocation(cpu.summary.topCpuCulprit)} (${formatPct(cpu.summary.topCpuCulprit.selfPct)} self, ${formatPct(cpu.summary.topCpuCulprit.totalPct)} total)`,
    );
  }
  if (
    isRenderableReviewFrame(cpu.summary?.topRequestEntry) &&
    !sameFrameLocation(cpu.summary.topRequestEntry, cpu.summary?.topCpuCulprit)
  ) {
    lines.push(
      `- top_request_entry: ${frameLabel(cpu.summary.topRequestEntry)} at ${frameLocation(cpu.summary.topRequestEntry)} (${formatPct(cpu.summary.topRequestEntry.totalPct)} total)`,
    );
  }
  if (
    isRenderableReviewFrame(cpu.summary?.topUserHotspot) &&
    !sameFrameLocation(cpu.summary.topUserHotspot, cpu.summary?.topCpuCulprit) &&
    !sameFrameLocation(cpu.summary.topUserHotspot, cpu.summary?.topRequestEntry)
  ) {
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
      hotspots.map((hotspot, hotspotIndex) => [
        String(hotspotIndex + 1),
        hotspot.function ?? '—',
        frameLocation(hotspot),
        formatPct(hotspot.selfPct),
        formatPct(hotspot.totalPct),
        userCallerCell(hotspot.userCaller),
      ]),
    );
  }
  const stacks = (cpu.hotStacks ?? []).slice(0, 3);
  const hotStackRows = stacks.flatMap((stack, stackIndex) => {
    const stackAnchorFrame =
      stack.frames.find((frame) => Boolean(frame.source) && isRenderableReviewFrame(frame)) ??
      stack.frames.find(isRenderableReviewFrame);
    if (!stackAnchorFrame) return [];
    return [
      [
        String(stackIndex + 1),
        stackAnchorFrame.function ?? '—',
        frameLocation(stackAnchorFrame),
        formatPct(stack.weightPct),
      ],
    ];
  });
  if (hotStackRows.length > 0) {
    lines.push('- hot_stacks:');
    appendIndentedTable(lines, ['#', 'anchor', 'location', 'weight%'], hotStackRows);
  }
  const clusters = (cpu.hotStackClusters ?? [])
    .filter((cluster) => isRenderableReviewFrame(cluster.anchor))
    .slice(0, 3);
  if (clusters.length > 0) {
    lines.push('- hot_stack_clusters:');
    appendIndentedTable(
      lines,
      ['#', 'anchor', 'location', 'weight%'],
      clusters.map((cluster, clusterIndex) => [
        String(clusterIndex + 1),
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
  lines.push(`- quality: ${memory.quality?.confidence ?? 'unknown'}`);
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
      allocators.map((allocator, allocatorIndex) => [
        String(allocatorIndex + 1),
        allocator.function ?? '—',
        frameLocation(allocator),
        formatPct(allocator.selfPct),
        formatPct(allocator.totalPct),
        userCallerCell(allocator.userCaller),
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
  const operationRows = (asyncProfile.topOperations ?? []).flatMap((operation, operationIndex) => {
    const operationFrame = preferredAsyncOperationFrame(operation);
    if (
      !isRenderableReviewFrame(operationFrame) &&
      !isRenderableReviewFrame(operation.userCaller)
    ) {
      return [];
    }
    return [
      [
        String(operationIndex + 1),
        operation.kind,
        String(operation.asyncId),
        isRenderableReviewFrame(operationFrame) ? frameLocation(operationFrame) : '—',
        formatScalarOrDash(operation.durationMs),
        userCallerCell(operation.userCaller),
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
      hotFiles.map((hotFile, index) => [
        String(index + 1),
        hotFile.primaryFrame.function ?? '—',
        frameLocation(hotFile.primaryFrame),
        formatPct(hotFile.cpuPct),
        userCallerCell(hotFile.userCaller),
      ]),
    );
  }
  const chainRows = (asyncProfile.cpuAttribution?.topChains ?? []).flatMap((chain, index) => {
    const frame = chain.executionFrame ?? chain.rootFrame;
    if (!isRenderableReviewFrame(frame) && !isRenderableReviewFrame(chain.userCaller)) return [];
    return [
      [
        String(index + 1),
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
