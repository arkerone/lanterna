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

export class TextReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'text';

  render(report: LanternaReport): string {
    const lines: string[] = [];
    lines.push('Lanterna Report');
    lines.push('');
    lines.push(`Duration: ${formatMs(report.meta?.durationMs)}`);
    lines.push(`Command: ${formatCommand(report.meta?.command)}`);
    const sourceMaps = report.meta?.captureIntegrity?.sourceMaps;
    if (sourceMaps?.enabled) {
      lines.push(
        `Source maps: ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded)`,
      );
    }
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
      this.renderHotspots(lines, cpu.hotspots ?? [], '    ');
      lines.push('');
    }

    const memory = report.profiles?.memory;
    if (memory) {
      lines.push('Memory');
      lines.push(`  Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
      lines.push('  Top allocators:');
      this.renderAllocators(lines, memory.hotAllocators ?? [], '    ');
      lines.push('');
    }

    lines.push('Findings');
    this.renderFindings(lines, report.findings ?? [], '  ');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private renderHotspots(lines: string[], hotspots: Hotspot[], indent: string): void {
    const top = hotspots.slice(0, 5);
    if (top.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const hotspot of top) {
      lines.push(
        `${indent}${hotspot.function} (${formatFrameLocation(hotspot)}): self ${formatPct(hotspot.selfPct)}, total ${formatPct(hotspot.totalPct)}`,
      );
    }
  }

  private renderAllocators(
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
        `${indent}${allocator.function} (${formatFrameLocation(allocator)}): self ${formatBytes(allocator.selfBytes)} (${formatPct(allocator.selfPct)}), total ${formatBytes(allocator.totalBytes)} (${formatPct(allocator.totalPct)})`,
      );
    }
  }

  private renderFindings(lines: string[], findings: Finding[], indent: string): void {
    if (findings.length === 0) {
      lines.push(`${indent}No findings`);
      return;
    }
    for (const f of findings) {
      lines.push(`${indent}[${f.severity}] ${f.title}`);
      lines.push(`${indent}  ${f.suggestion}`);
      lines.push(
        `${indent}  Evidence: ${f.evidence.function} (${formatFrameLocation(f.evidence)})`,
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
}
