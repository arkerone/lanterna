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

export class MarkdownReportRenderer implements ReportRenderer {
  readonly format: RenderableFormat = 'markdown';

  render(report: LanternaReport): string {
    const view = buildReportView(report);
    const lines: string[] = [];
    lines.push('# Lanterna Report');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Duration | ${formatMs(report.meta?.durationMs)} |`);
    lines.push(`| Command | \`${escapeBackticks(formatCommand(report.meta?.command))}\` |`);
    const sourceMaps = view.sourceMaps;
    if (sourceMaps?.enabled) {
      const status = sourceMaps.status ? `, status ${sourceMaps.status}` : '';
      const applicable =
        sourceMaps.applicable !== undefined ? `, applicable ${sourceMaps.applicable}` : '';
      lines.push(
        `| Source maps | ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded${status}${applicable}) |`,
      );
    }
    lines.push('');

    const cpuView = view.cpu;
    if (cpuView) {
      const cpu = cpuView.profile;
      lines.push('## CPU');
      lines.push('');
      lines.push(`- On CPU: ${formatRatio(cpu.summary?.onCpuRatio)}`);
      lines.push(`- Event loop: ${formatEventLoop(cpu.eventLoop)}`);
      lines.push(
        `- GC: ${formatMs(cpu.gc?.totalPauseMs)} total pause, ${formatMs(cpu.gc?.longestPauseMs)} longest`,
      );
      if (cpuView.topCpuCulprit) {
        lines.push(
          `- Top CPU culprit: ${escapePipe(cpuView.topCpuCulprit.function)} at \`${escapeBackticks(formatFrameLocation(cpuView.topCpuCulprit))}\` (${formatPct(cpuView.topCpuCulprit.selfPct)} self, ${formatPct(cpuView.topCpuCulprit.totalPct)} total)`,
        );
      }
      if (cpuView.topRequestEntry) {
        lines.push(
          `- Top request entry: ${escapePipe(cpuView.topRequestEntry.function)} at \`${escapeBackticks(formatFrameLocation(cpuView.topRequestEntry))}\` (${formatPct(cpuView.topRequestEntry.totalPct)} total)`,
        );
      }
      lines.push('');
      lines.push('### Top CPU Hotspots');
      this.renderHotspots(lines, cpuView.hotspots);
      lines.push('');
    }

    const memoryView = view.memory;
    if (memoryView) {
      const memory = memoryView.profile;
      lines.push('## Memory');
      lines.push('');
      lines.push(`- Quality: ${memory.quality?.confidence ?? 'unknown'}`);
      lines.push(`- Total sampled: ${formatBytes(memory.summary?.totalSampledBytes)}`);
      if (memoryView.topAllocatorUserCaller) {
        lines.push(
          `- Top allocator user caller: ${formatUserCaller(memoryView.topAllocatorUserCaller)}`,
        );
      }
      lines.push('');
      lines.push('### Top Allocators');
      this.renderAllocators(lines, memoryView.allocators);
      lines.push('');
    }

    const asyncView = view.async;
    if (asyncView) {
      lines.push('## Async');
      lines.push('');
      if (asyncView.topHotFileUserCaller) {
        lines.push(
          `- Top hot file user caller: ${formatUserCaller(asyncView.topHotFileUserCaller)}`,
        );
        lines.push('');
      }
      lines.push('### Top Operations');
      this.renderAsyncTopOperations(lines, asyncView.operations);
      lines.push('');
      lines.push('### Hot Files');
      this.renderAsyncHotFiles(lines, asyncView.hotFiles);
      lines.push('');
      lines.push('### CPU Attribution');
      this.renderAsyncCpuChains(lines, asyncView.cpuChains);
      lines.push('');
    }

    lines.push('## Findings');
    lines.push('');
    this.renderFindings(lines, view.findings);
    return `${lines.join('\n').trimEnd()}\n`;
  }

  private renderHotspots(lines: string[], hotspots: Hotspot[]): void {
    if (hotspots.length === 0) {
      lines.push('No CPU hotspots.');
      return;
    }
    lines.push('| Function | Location | Self | Total | User caller |');
    lines.push('| --- | --- | ---: | ---: | --- |');
    for (const hotspot of hotspots) {
      lines.push(
        `| ${escapePipe(hotspot.function)} | \`${escapeBackticks(formatFrameLocation(hotspot))}\` | ${formatPct(hotspot.selfPct)} | ${formatPct(hotspot.totalPct)} | ${hotspot.userCaller ? escapePipe(formatUserCaller(hotspot.userCaller)) : ''} |`,
      );
    }
  }

  private renderAllocators(lines: string[], allocators: MemoryHotAllocator[]): void {
    if (allocators.length === 0) {
      lines.push('No memory allocators.');
      return;
    }
    lines.push('| Function | Location | Self | Total | User caller |');
    lines.push('| --- | --- | ---: | ---: | --- |');
    for (const allocator of allocators) {
      lines.push(
        `| ${escapePipe(allocator.function)} | \`${escapeBackticks(formatFrameLocation(allocator))}\` | ${formatBytes(allocator.selfBytes)} (${formatPct(allocator.selfPct)}) | ${formatBytes(allocator.totalBytes)} (${formatPct(allocator.totalPct)}) | ${allocator.userCaller ? escapePipe(formatUserCaller(allocator.userCaller)) : ''} |`,
      );
    }
  }

  private renderAsyncTopOperations(lines: string[], operations: AsyncTopOperation[]): void {
    if (operations.length === 0) {
      lines.push('No async operations.');
      return;
    }
    lines.push('| Async ID | Kind | Duration | Run | User caller |');
    lines.push('| ---: | --- | ---: | ---: | --- |');
    for (const operation of operations) {
      lines.push(
        `| ${operation.asyncId} | ${operation.kind} | ${formatMs(operation.durationMs)} | ${formatMs(operation.runMs)} | ${operation.userCaller ? escapePipe(formatUserCaller(operation.userCaller)) : ''} |`,
      );
    }
  }

  private renderAsyncHotFiles(lines: string[], hotFiles: AsyncHotFile[]): void {
    if (hotFiles.length === 0) {
      lines.push('No async hot files.');
      return;
    }
    lines.push('| File | CPU | Ops | User caller |');
    lines.push('| --- | ---: | ---: | --- |');
    for (const hotFile of hotFiles) {
      lines.push(
        `| \`${escapeBackticks(hotFile.file)}\` | ${formatPct(hotFile.cpuPct)} | ${hotFile.operationCount} | ${hotFile.userCaller ? escapePipe(formatUserCaller(hotFile.userCaller)) : ''} |`,
      );
    }
  }

  private renderAsyncCpuChains(lines: string[], chains: AsyncCpuAttributionEntry[]): void {
    if (chains.length === 0) {
      lines.push('No async CPU chains.');
      return;
    }
    lines.push('| Root async ID | Kind | CPU | CPU ms | User caller |');
    lines.push('| ---: | --- | ---: | ---: | --- |');
    for (const chain of chains) {
      lines.push(
        `| ${chain.rootAsyncId} | ${chain.rootKind} | ${formatPct(chain.cpuPct)} | ${formatMs(chain.cpuMs)} | ${chain.userCaller ? escapePipe(formatUserCaller(chain.userCaller)) : ''} |`,
      );
    }
  }

  private renderFindings(lines: string[], findings: ReportFindingView[]): void {
    if (findings.length === 0) {
      lines.push('No findings.');
      return;
    }
    for (const findingView of findings) {
      const { candidateCallers, finding, userCaller } = findingView;
      lines.push(`### ${finding.title}`);
      lines.push('');
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Kind: ${finding.profileKind}`);
      lines.push(
        `- Evidence: \`${escapeBackticks(finding.evidence.function)}\` at \`${escapeBackticks(formatFrameLocation(finding.evidence))}\``,
      );
      if (userCaller) lines.push(`- User caller: ${formatUserCaller(userCaller)}`);
      if (candidateCallers.length > 0) {
        lines.push('- Candidate callers:');
        for (const caller of candidateCallers) {
          lines.push(`  - ${formatUserCaller(caller)}`);
        }
      }
      lines.push(`- Suggestion: ${finding.suggestion}`);
      if (finding.evidence.extra !== undefined) {
        const extra = renderValue(finding.evidence.extra);
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
