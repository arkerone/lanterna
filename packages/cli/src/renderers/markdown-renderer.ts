import type { Finding, Hotspot, LanternaReport, MemoryHotAllocator } from '@lanterna-profiler/core';
import {
  formatBytes,
  formatCommand,
  formatEventLoop,
  formatFrameLocation,
  formatMs,
  formatPct,
  formatRatio,
} from './formatting.js';
import { renderValue } from './generic.js';
import type { RenderableFormat, ReportRenderer } from './types.js';

export class MarkdownReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'markdown';

  render(report: LanternaReport): string {
    const lines: string[] = [];
    lines.push('# Lanterna Report');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Duration | ${formatMs(report.meta?.durationMs)} |`);
    lines.push(`| Command | \`${escapeBackticks(formatCommand(report.meta?.command))}\` |`);
    const sourceMaps = report.meta?.captureIntegrity?.sourceMaps;
    if (sourceMaps?.enabled) {
      lines.push(
        `| Source maps | ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded) |`,
      );
    }
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
      this.renderHotspots(lines, cpu.hotspots ?? []);
      lines.push('');
    }

    const memory = report.profiles?.memory;
    if (memory) {
      lines.push('## Memory');
      lines.push('');
      lines.push(`- Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
      lines.push('');
      lines.push('### Top Allocators');
      this.renderAllocators(lines, memory.hotAllocators ?? []);
      lines.push('');
    }

    lines.push('## Findings');
    lines.push('');
    this.renderFindings(lines, report.findings ?? []);
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private renderHotspots(lines: string[], hotspots: Hotspot[]): void {
    if (hotspots.length === 0) {
      lines.push('No CPU hotspots.');
      return;
    }
    lines.push('| Function | Location | Self | Total |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const hotspot of hotspots.slice(0, 5)) {
      lines.push(
        `| ${escapePipe(hotspot.function)} | \`${escapeBackticks(formatFrameLocation(hotspot))}\` | ${formatPct(hotspot.selfPct)} | ${formatPct(hotspot.totalPct)} |`,
      );
    }
  }

  private renderAllocators(lines: string[], allocators: MemoryHotAllocator[]): void {
    if (allocators.length === 0) {
      lines.push('No memory allocators.');
      return;
    }
    lines.push('| Function | Location | Self | Total |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const allocator of allocators.slice(0, 5)) {
      lines.push(
        `| ${escapePipe(allocator.function)} | \`${escapeBackticks(formatFrameLocation(allocator))}\` | ${formatBytes(allocator.selfBytes)} (${formatPct(allocator.selfPct)}) | ${formatBytes(allocator.totalBytes)} (${formatPct(allocator.totalPct)}) |`,
      );
    }
  }

  private renderFindings(lines: string[], findings: Finding[]): void {
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
        `- Evidence: \`${escapeBackticks(f.evidence.function)}\` at \`${escapeBackticks(formatFrameLocation(f.evidence))}\``,
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
}

function escapePipe(value: string): string {
  return value.replaceAll('|', '\\|');
}

function escapeBackticks(value: string): string {
  return value.replaceAll('`', '\\`');
}
