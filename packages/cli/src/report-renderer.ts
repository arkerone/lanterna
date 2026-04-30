import type { Finding, Hotspot, LanternaReport, MemoryHotAllocator } from '@lanterna-profiler/core';
import type { OutputFormat } from './parse.js';

export function renderReport(
  report: LanternaReport,
  options: { format: Exclude<OutputFormat, 'json'> },
): string {
  return options.format === 'markdown' ? renderMarkdown(report) : renderText(report);
}

function renderText(report: LanternaReport): string {
  const lines: string[] = [];
  lines.push('Lanterna Report');
  lines.push('');
  lines.push(`Mode: ${report.meta?.mode ?? 'unknown'}`);
  lines.push(`Duration: ${formatMs(report.meta?.durationMs)}`);
  lines.push(`Command: ${formatCommand(report.meta?.command)}`);
  lines.push(`Kinds: ${formatList(report.meta?.profileKinds)}`);
  lines.push('');

  const cpu = report.profiles?.cpu;
  if (cpu) {
    lines.push('CPU');
    lines.push(`  Confidence: ${cpu.quality?.confidence ?? 'unknown'}`);
    lines.push(`  Samples: ${cpu.quality?.sampleCount ?? 'unknown'}`);
    lines.push(`  On CPU: ${formatRatio(cpu.summary?.onCpuRatio)}`);
    lines.push(`  Idle: ${formatRatio(cpu.summary?.idleRatio)}`);
    lines.push(`  Event loop: ${formatEventLoop(cpu.eventLoop)}`);
    lines.push(
      `  GC: ${formatMs(cpu.gc?.totalPauseMs)} total pause, ${cpu.gc?.longestPauseMs ?? 0}ms longest`,
    );
    lines.push('  Top hotspots:');
    pushHotspots(lines, cpu.hotspots ?? [], '    ');
    lines.push('');
  }

  const memory = report.profiles?.memory;
  if (memory) {
    lines.push('Memory');
    lines.push(`  Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
    lines.push(`  Memory samples: ${memory.memoryUsage?.sampleCount ?? 0}`);
    lines.push('  Top allocators:');
    pushAllocators(lines, memory.hotAllocators ?? [], '    ');
    lines.push('');
  }

  lines.push('Findings');
  pushFindingsText(lines, report.findings ?? [], '  ');
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderMarkdown(report: LanternaReport): string {
  const lines: string[] = [];
  lines.push('# Lanterna Report');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Mode | ${escapePipe(report.meta?.mode ?? 'unknown')} |`);
  lines.push(`| Duration | ${formatMs(report.meta?.durationMs)} |`);
  lines.push(`| Command | \`${escapeBackticks(formatCommand(report.meta?.command))}\` |`);
  lines.push(`| Kinds | ${escapePipe(formatList(report.meta?.profileKinds))} |`);
  lines.push('');

  const cpu = report.profiles?.cpu;
  if (cpu) {
    lines.push('## CPU');
    lines.push('');
    lines.push(`- Confidence: ${cpu.quality?.confidence ?? 'unknown'}`);
    lines.push(`- Samples: ${cpu.quality?.sampleCount ?? 'unknown'}`);
    lines.push(`- On CPU: ${formatRatio(cpu.summary?.onCpuRatio)}`);
    lines.push(`- Idle: ${formatRatio(cpu.summary?.idleRatio)}`);
    lines.push(`- Event loop: ${formatEventLoop(cpu.eventLoop)}`);
    lines.push(
      `- GC: ${formatMs(cpu.gc?.totalPauseMs)} total pause, ${cpu.gc?.longestPauseMs ?? 0}ms longest`,
    );
    lines.push('');
    lines.push('### Top CPU Hotspots');
    pushHotspotsMarkdown(lines, cpu.hotspots ?? []);
    lines.push('');
  }

  const memory = report.profiles?.memory;
  if (memory) {
    lines.push('## Memory');
    lines.push('');
    lines.push(`- Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
    lines.push(`- Memory samples: ${memory.memoryUsage?.sampleCount ?? 0}`);
    lines.push('');
    lines.push('### Top Allocators');
    pushAllocatorsMarkdown(lines, memory.hotAllocators ?? []);
    lines.push('');
  }

  lines.push('## Findings');
  pushFindingsMarkdown(lines, report.findings ?? []);
  return `${lines.join('\n').trimEnd()}\n`;
}

function pushHotspots(lines: string[], hotspots: Hotspot[], indent: string): void {
  const top = hotspots.slice(0, 5);
  if (top.length === 0) {
    lines.push(`${indent}None`);
    return;
  }
  for (const hotspot of top) {
    lines.push(
      `${indent}${hotspot.function} (${formatLocation(hotspot.file, hotspot.line)}): self ${formatPct(hotspot.selfPct)}, total ${formatPct(hotspot.totalPct)}`,
    );
  }
}

function pushAllocators(lines: string[], allocators: MemoryHotAllocator[], indent: string): void {
  const top = allocators.slice(0, 5);
  if (top.length === 0) {
    lines.push(`${indent}None`);
    return;
  }
  for (const allocator of top) {
    lines.push(
      `${indent}${allocator.function} (${formatLocation(allocator.file, allocator.line)}): self ${formatBytes(allocator.selfBytes)} (${formatPct(allocator.selfPct)}), total ${formatBytes(allocator.totalBytes)} (${formatPct(allocator.totalPct)})`,
    );
  }
}

function pushHotspotsMarkdown(lines: string[], hotspots: Hotspot[]): void {
  if (hotspots.length === 0) {
    lines.push('No CPU hotspots.');
    return;
  }
  lines.push('| Function | Location | Self | Total |');
  lines.push('| --- | --- | ---: | ---: |');
  for (const hotspot of hotspots.slice(0, 5)) {
    lines.push(
      `| ${escapePipe(hotspot.function)} | \`${escapeBackticks(formatLocation(hotspot.file, hotspot.line))}\` | ${formatPct(hotspot.selfPct)} | ${formatPct(hotspot.totalPct)} |`,
    );
  }
}

function pushAllocatorsMarkdown(lines: string[], allocators: MemoryHotAllocator[]): void {
  if (allocators.length === 0) {
    lines.push('No memory allocators.');
    return;
  }
  lines.push('| Function | Location | Self | Total |');
  lines.push('| --- | --- | ---: | ---: |');
  for (const allocator of allocators.slice(0, 5)) {
    lines.push(
      `| ${escapePipe(allocator.function)} | \`${escapeBackticks(formatLocation(allocator.file, allocator.line))}\` | ${formatBytes(allocator.selfBytes)} (${formatPct(allocator.selfPct)}) | ${formatBytes(allocator.totalBytes)} (${formatPct(allocator.totalPct)}) |`,
    );
  }
}

function pushFindingsText(lines: string[], findings: Finding[], indent: string): void {
  if (findings.length === 0) {
    lines.push(`${indent}No findings`);
    return;
  }
  for (const finding of findings) {
    lines.push(`${indent}[${finding.severity}] ${finding.title}`);
    lines.push(`${indent}  ${finding.suggestion}`);
    lines.push(
      `${indent}  Evidence: ${finding.evidence.function} (${formatLocation(finding.evidence.file, finding.evidence.line)})`,
    );
  }
}

function pushFindingsMarkdown(lines: string[], findings: Finding[]): void {
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }
  for (const finding of findings) {
    lines.push(`### ${finding.title}`);
    lines.push('');
    lines.push(`- Severity: ${finding.severity}`);
    lines.push(`- Kind: ${finding.profileKind}`);
    lines.push(
      `- Evidence: \`${escapeBackticks(finding.evidence.function)}\` at \`${escapeBackticks(formatLocation(finding.evidence.file, finding.evidence.line))}\``,
    );
    lines.push(`- Suggestion: ${finding.suggestion}`);
    lines.push('');
  }
}

function formatCommand(command: string[] | undefined): string {
  return command && command.length > 0 ? command.join(' ') : '(unknown)';
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : '(none)';
}

function formatMs(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${Math.round(value)}ms`;
}

function formatRatio(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return formatPct(value * 100);
}

function formatPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function formatLocation(file: string, line: number): string {
  return `${file}:${line}`;
}

function formatEventLoop(
  eventLoop: { available?: boolean; p99LagMs?: number; maxLagMs?: number } | undefined,
): string {
  if (!eventLoop?.available) return 'unavailable';
  return `p99 ${formatMs(eventLoop.p99LagMs)}, max ${formatMs(eventLoop.maxLagMs)}`;
}

function escapePipe(value: string): string {
  return value.replaceAll('|', '\\|');
}

function escapeBackticks(value: string): string {
  return value.replaceAll('`', '\\`');
}
