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
      const status = sourceMaps.status ? `, status ${sourceMaps.status}` : '';
      const applicable =
        sourceMaps.applicable !== undefined ? `, applicable ${sourceMaps.applicable}` : '';
      lines.push(
        `| Source maps | ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded${status}${applicable}) |`,
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
      if (memory.summary?.topAllocator?.userCaller) {
        lines.push(
          `- Top allocator user caller: ${formatUserCaller(memory.summary.topAllocator.userCaller)}`,
        );
      }
      lines.push('');
      lines.push('### Top Allocators');
      this.renderAllocators(lines, memory.hotAllocators ?? []);
      lines.push('');
    }

    const async_ = report.profiles?.async;
    if (async_) {
      lines.push('## Async');
      lines.push('');
      if (async_.summary?.topAsyncHotFile?.userCaller) {
        lines.push(
          `- Top hot file user caller: ${formatUserCaller(async_.summary.topAsyncHotFile.userCaller)}`,
        );
        lines.push('');
      }
      lines.push('### Top Operations');
      this.renderAsyncTopOperations(lines, async_.topOperations ?? []);
      lines.push('');
      lines.push('### Hot Files');
      this.renderAsyncHotFiles(lines, async_.hotFiles ?? []);
      lines.push('');
      lines.push('### CPU Attribution');
      this.renderAsyncCpuChains(lines, async_.cpuAttribution?.topChains ?? []);
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
    lines.push('| Function | Location | Self | Total | User caller |');
    lines.push('| --- | --- | ---: | ---: | --- |');
    for (const hotspot of hotspots.slice(0, 5)) {
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
    for (const allocator of allocators.slice(0, 5)) {
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
    for (const op of operations.slice(0, 5)) {
      lines.push(
        `| ${op.asyncId} | ${op.kind} | ${formatMs(op.durationMs)} | ${formatMs(op.runMs)} | ${op.userCaller ? escapePipe(formatUserCaller(op.userCaller)) : ''} |`,
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
    for (const file of hotFiles.slice(0, 5)) {
      lines.push(
        `| \`${escapeBackticks(file.file)}\` | ${formatPct(file.cpuPct)} | ${file.operationCount} | ${file.userCaller ? escapePipe(formatUserCaller(file.userCaller)) : ''} |`,
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
    for (const chain of chains.slice(0, 5)) {
      lines.push(
        `| ${chain.rootAsyncId} | ${chain.rootKind} | ${formatPct(chain.cpuPct)} | ${formatMs(chain.cpuMs)} | ${chain.userCaller ? escapePipe(formatUserCaller(chain.userCaller)) : ''} |`,
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
      const userCaller = userCallerFromEvidenceExtra(f.evidence.extra);
      if (userCaller) lines.push(`- User caller: ${formatUserCaller(userCaller)}`);
      const candidateCallers = candidateCallersFromEvidenceExtra(f.evidence.extra);
      if (candidateCallers.length > 0) {
        lines.push('- Candidate callers:');
        for (const caller of candidateCallers) {
          lines.push(`  - ${formatUserCaller(caller)}`);
        }
      }
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

function userCallerFromEvidenceExtra(extra: unknown): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}

function candidateCallersFromEvidenceExtra(extra: unknown): UserCallerAttribution[] {
  if (!extra || typeof extra !== 'object') return [];
  const value = (extra as { candidateCallers?: unknown }).candidateCallers;
  return Array.isArray(value) ? (value as UserCallerAttribution[]) : [];
}
