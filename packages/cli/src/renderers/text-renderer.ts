import type {
  AsyncCpuAttributionEntry,
  AsyncHotFile,
  AsyncTopOperation,
  Hotspot,
  LanternaReport,
  MemoryHotAllocator,
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
import type { ReportFindingView } from './report-view.js';
import { buildReportView } from './report-view.js';
import type { RenderableFormat, ReportRenderer } from './types.js';

export class TextReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'text';

  render(report: LanternaReport): string {
    const view = buildReportView(report);
    const lines: string[] = [];
    lines.push('Lanterna Report');
    lines.push('');
    lines.push(`Duration: ${formatMs(report.meta?.durationMs)}`);
    lines.push(`Command: ${formatCommand(report.meta?.command)}`);
    const sourceMaps = view.sourceMaps;
    if (sourceMaps?.enabled) {
      const status = sourceMaps.status ? `, status ${sourceMaps.status}` : '';
      const applicable =
        sourceMaps.applicable !== undefined ? `, applicable ${sourceMaps.applicable}` : '';
      lines.push(
        `Source maps: ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded${status}${applicable})`,
      );
    }
    lines.push('');

    const cpuView = view.cpu;
    if (cpuView) {
      const cpu = cpuView.profile;
      lines.push('CPU');
      lines.push(`  On CPU: ${formatRatio(cpu.summary?.onCpuRatio)}`);
      lines.push(`  Event loop: ${formatEventLoop(cpu.eventLoop)}`);
      lines.push(
        `  GC: ${formatMs(cpu.gc?.totalPauseMs)} total pause, ${formatMs(cpu.gc?.longestPauseMs)} longest`,
      );
      if (cpuView.topCpuCulprit) {
        lines.push(
          `  Top CPU culprit: ${cpuView.topCpuCulprit.function} (${formatFrameLocation(cpuView.topCpuCulprit)}): self ${formatPct(cpuView.topCpuCulprit.selfPct)}, total ${formatPct(cpuView.topCpuCulprit.totalPct)}`,
        );
      }
      if (cpuView.topRequestEntry) {
        lines.push(
          `  Top request entry: ${cpuView.topRequestEntry.function} (${formatFrameLocation(cpuView.topRequestEntry)}): total ${formatPct(cpuView.topRequestEntry.totalPct)}`,
        );
      }
      lines.push('  Top hotspots:');
      this.renderHotspots(lines, cpuView.hotspots, '    ');
      lines.push('');
    }

    const memoryView = view.memory;
    if (memoryView) {
      const memory = memoryView.profile;
      lines.push('Memory');
      lines.push(`  Quality: ${memory.quality?.confidence ?? 'unknown'}`);
      lines.push(`  Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
      if (memoryView.topAllocatorUserCaller) {
        lines.push(
          `  Top allocator user caller: ${formatUserCaller(memoryView.topAllocatorUserCaller)}`,
        );
      }
      lines.push('  Top allocators:');
      this.renderAllocators(lines, memoryView.allocators, '    ');
      lines.push('');
    }

    const asyncView = view.async;
    if (asyncView) {
      lines.push('Async');
      if (asyncView.topHotFileUserCaller) {
        lines.push(
          `  Top hot file user caller: ${formatUserCaller(asyncView.topHotFileUserCaller)}`,
        );
      }
      lines.push('  Top operations:');
      this.renderAsyncTopOperations(lines, asyncView.operations, '    ');
      lines.push('  Hot files:');
      this.renderAsyncHotFiles(lines, asyncView.hotFiles, '    ');
      lines.push('  CPU attribution:');
      this.renderAsyncCpuChains(lines, asyncView.cpuChains, '    ');
      lines.push('');
    }

    lines.push('Findings');
    this.renderFindings(lines, view.findings, '  ');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private renderHotspots(lines: string[], hotspots: Hotspot[], indent: string): void {
    if (hotspots.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const hotspot of hotspots) {
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
    if (allocators.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const allocator of allocators) {
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
    if (operations.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const operation of operations) {
      lines.push(
        `${indent}#${operation.asyncId} ${operation.kind} (${formatMs(operation.durationMs)}, run ${formatMs(operation.runMs)})`,
      );
      if (operation.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(operation.userCaller)}`);
      }
    }
  }

  private renderAsyncHotFiles(lines: string[], hotFiles: AsyncHotFile[], indent: string): void {
    if (hotFiles.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const hotFile of hotFiles) {
      lines.push(
        `${indent}${hotFile.file}: cpu ${formatPct(hotFile.cpuPct)}, ops ${hotFile.operationCount}`,
      );
      if (hotFile.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(hotFile.userCaller)}`);
      }
    }
  }

  private renderAsyncCpuChains(
    lines: string[],
    chains: AsyncCpuAttributionEntry[],
    indent: string,
  ): void {
    if (chains.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const chain of chains) {
      lines.push(
        `${indent}root #${chain.rootAsyncId} ${chain.rootKind}: cpu ${formatPct(chain.cpuPct)} (${formatMs(chain.cpuMs)})`,
      );
      if (chain.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(chain.userCaller)}`);
      }
    }
  }

  private renderFindings(lines: string[], findings: ReportFindingView[], indent: string): void {
    if (findings.length === 0) {
      lines.push(`${indent}No findings`);
      return;
    }
    for (const findingView of findings) {
      const { candidateCallers, finding, userCaller } = findingView;
      lines.push(`${indent}[${finding.severity}] ${finding.title}`);
      lines.push(`${indent}  ${finding.suggestion}`);
      lines.push(
        `${indent}  Evidence: ${finding.evidence.function} (${formatFrameLocation(finding.evidence)})`,
      );
      if (userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(userCaller)}`);
      }
      if (candidateCallers.length > 0) {
        lines.push(`${indent}  Candidate callers:`);
        for (const caller of candidateCallers) {
          lines.push(`${indent}    - ${formatUserCaller(caller)}`);
        }
      }
      if (finding.evidence.extra !== undefined) {
        const extra = renderValue(finding.evidence.extra);
        if (extra.length > 0) {
          lines.push(`${indent}  Details:`);
          for (const line of extra) lines.push(`${indent}    ${line}`);
        }
      }
    }
  }
}
