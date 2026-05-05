import type {
  AsyncCpuAttributionEntry,
  AsyncHotFile,
  AsyncTopOperation,
  Finding,
  Hotspot,
  LanternaReport,
  MemoryHotAllocator,
  UserCallerAttribution,
} from '@lanterna-profiler/core';
import {
  formatBytes,
  formatCommand,
  formatEventLoop,
  formatFrameLocation,
  formatMs,
  formatPct,
  formatRatio,
  formatUserCaller,
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
      if (memory.summary?.topAllocator?.userCaller) {
        lines.push(
          `  Top allocator user caller: ${formatUserCaller(memory.summary.topAllocator.userCaller)}`,
        );
      }
      lines.push('  Top allocators:');
      this.renderAllocators(lines, memory.hotAllocators ?? [], '    ');
      lines.push('');
    }

    const async_ = report.profiles?.async;
    if (async_) {
      lines.push('Async');
      if (async_.summary?.topAsyncHotFile?.userCaller) {
        lines.push(
          `  Top hot file user caller: ${formatUserCaller(async_.summary.topAsyncHotFile.userCaller)}`,
        );
      }
      lines.push('  Top operations:');
      this.renderAsyncTopOperations(lines, async_.topOperations ?? [], '    ');
      lines.push('  Hot files:');
      this.renderAsyncHotFiles(lines, async_.hotFiles ?? [], '    ');
      lines.push('  CPU attribution:');
      this.renderAsyncCpuChains(lines, async_.cpuAttribution?.topChains ?? [], '    ');
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
      if (hotspot.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(hotspot.userCaller)}`);
      }
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
      if (allocator.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(allocator.userCaller)}`);
      }
    }
  }

  private renderAsyncTopOperations(
    lines: string[],
    operations: AsyncTopOperation[],
    indent: string,
  ): void {
    const top = operations.slice(0, 5);
    if (top.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const op of top) {
      lines.push(
        `${indent}#${op.asyncId} ${op.kind} (${formatMs(op.durationMs)}, run ${formatMs(op.runMs)})`,
      );
      if (op.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(op.userCaller)}`);
      }
    }
  }

  private renderAsyncHotFiles(lines: string[], hotFiles: AsyncHotFile[], indent: string): void {
    const top = hotFiles.slice(0, 5);
    if (top.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const file of top) {
      lines.push(
        `${indent}${file.file}: cpu ${formatPct(file.cpuPct)}, ops ${file.operationCount}`,
      );
      if (file.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(file.userCaller)}`);
      }
    }
  }

  private renderAsyncCpuChains(
    lines: string[],
    chains: AsyncCpuAttributionEntry[],
    indent: string,
  ): void {
    const top = chains.slice(0, 5);
    if (top.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const chain of top) {
      lines.push(
        `${indent}root #${chain.rootAsyncId} ${chain.rootKind}: cpu ${formatPct(chain.cpuPct)} (${formatMs(chain.cpuMs)})`,
      );
      if (chain.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(chain.userCaller)}`);
      }
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
      const userCaller = userCallerFromEvidenceExtra(f.evidence.extra);
      if (userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(userCaller)}`);
      }
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

function userCallerFromEvidenceExtra(extra: unknown): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}
