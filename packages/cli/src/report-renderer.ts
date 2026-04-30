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
  lines.push(`Duration: ${formatMs(report.meta?.durationMs)}`);
  lines.push(`Command: ${formatCommand(report.meta?.command)}`);
  lines.push('');

  const cpu = report.profiles?.cpu;
  if (cpu) {
    lines.push('CPU');
    lines.push(`  On CPU: ${formatRatio(cpu.summary?.onCpuRatio)}`);
    lines.push(`  Event loop: ${formatEventLoop(cpu.eventLoop)}`);
    lines.push(
      `  GC: ${formatMs(cpu.gc?.totalPauseMs)} total pause, ${formatMs(cpu.gc?.longestPauseMs)} longest`,
    );
    lines.push('  Top hotspots:');
    pushHotspotsText(lines, cpu.hotspots ?? [], '    ');
    lines.push('');
  }

  const memory = report.profiles?.memory;
  if (memory) {
    lines.push('Memory');
    lines.push(`  Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
    lines.push('  Top allocators:');
    pushAllocatorsText(lines, memory.hotAllocators ?? [], '    ');
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
  lines.push(`| Duration | ${formatMs(report.meta?.durationMs)} |`);
  lines.push(`| Command | \`${escapeBackticks(formatCommand(report.meta?.command))}\` |`);
  lines.push('');

  const cpu = report.profiles?.cpu;
  if (cpu) {
    lines.push('## CPU');
    lines.push('');
    lines.push(`- On CPU: ${formatRatio(cpu.summary?.onCpuRatio)}`);
    lines.push(`- Event loop: ${formatEventLoop(cpu.eventLoop)}`);
    lines.push(
      `- GC: ${formatMs(cpu.gc?.totalPauseMs)} total pause, ${formatMs(cpu.gc?.longestPauseMs)} longest`,
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
    lines.push('');
    lines.push('### Top Allocators');
    pushAllocatorsMarkdown(lines, memory.hotAllocators ?? []);
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');
  pushFindingsMarkdown(lines, report.findings ?? []);
  return `${lines.join('\n').trimEnd()}\n`;
}

function pushHotspotsText(lines: string[], hotspots: Hotspot[], indent: string): void {
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

function pushAllocatorsText(
  lines: string[],
  allocators: MemoryHotAllocator[],
  indent: string,
): void {
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
  for (const f of findings) {
    lines.push(`${indent}[${f.severity}] ${f.title}`);
    lines.push(`${indent}  ${f.suggestion}`);
    lines.push(
      `${indent}  Evidence: ${f.evidence.function} (${formatLocation(f.evidence.file, f.evidence.line)})`,
    );
    if (f.evidence.extra !== undefined) {
      const extra = renderValue(f.evidence.extra);
      if (extra.length > 0) {
        lines.push(`${indent}  Details:`);
        for (const line of extra) lines.push(`${indent}    ${line}`);
      }
    }
  }
}

function pushFindingsMarkdown(lines: string[], findings: Finding[]): void {
  if (findings.length === 0) {
    lines.push('No findings.');
    return;
  }
  for (const f of findings) {
    lines.push(`### ${f.title}`);
    lines.push('');
    lines.push(`- Severity: ${f.severity}`);
    lines.push(`- Kind: ${f.profileKind}`);
    lines.push(
      `- Evidence: \`${escapeBackticks(f.evidence.function)}\` at \`${escapeBackticks(formatLocation(f.evidence.file, f.evidence.line))}\``,
    );
    lines.push(`- Suggestion: ${f.suggestion}`);
    if (f.evidence.extra !== undefined) {
      const extra = renderValue(f.evidence.extra);
      if (extra.length > 0) {
        lines.push('- Details:');
        for (const line of extra) lines.push(`  ${line}`);
      }
    }
    lines.push('');
  }
}

/**
 * Generic, schema-agnostic walker. Renders any JSON-shaped value as
 * indented `key: value` lines (objects) and `- item` lines (arrays),
 * with primitives inlined and nested structures recursed into.
 */
function renderValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [String(value)];
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const lines: string[] = [];
    for (const item of value) {
      const sub = renderValue(item);
      if (sub.length === 0) {
        lines.push('- (empty)');
        continue;
      }
      lines.push(`- ${sub[0]}`);
      for (const line of sub.slice(1)) lines.push(`  ${line}`);
    }
    return lines;
  }
  const lines: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined || child === null) continue;
    if (typeof child !== 'object') {
      lines.push(`${key}: ${String(child)}`);
      continue;
    }
    if (Array.isArray(child) && child.every((x) => x === null || typeof x !== 'object')) {
      lines.push(`${key}: [${child.map((x) => (x === null ? 'null' : String(x))).join(', ')}]`);
      continue;
    }
    const sub = renderValue(child);
    if (sub.length === 0) continue;
    lines.push(`${key}:`);
    for (const line of sub) lines.push(`  ${line}`);
  }
  return lines;
}

function formatCommand(command: string[] | undefined): string {
  return command && command.length > 0 ? command.join(' ') : '(unknown)';
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
