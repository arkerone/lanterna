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
      const status = sourceMaps.status ? `, status ${sourceMaps.status}` : '';
      const applicable =
        sourceMaps.applicable !== undefined ? `, applicable ${sourceMaps.applicable}` : '';
      lines.push(
        `Source maps: ${formatRatio(sourceMaps.coverage)} coverage (${sourceMaps.mapsLoaded} maps loaded${status}${applicable})`,
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
      if (cpu.summary?.topCpuCulprit) {
        lines.push(
          `  Top CPU culprit: ${cpu.summary.topCpuCulprit.function} (${formatFrameLocation(cpu.summary.topCpuCulprit)}): self ${formatPct(cpu.summary.topCpuCulprit.selfPct)}, total ${formatPct(cpu.summary.topCpuCulprit.totalPct)}`,
        );
      }
      if (
        cpu.summary?.topRequestEntry &&
        !sameFrameLocation(cpu.summary.topRequestEntry, cpu.summary.topCpuCulprit)
      ) {
        lines.push(
          `  Top request entry: ${cpu.summary.topRequestEntry.function} (${formatFrameLocation(cpu.summary.topRequestEntry)}): total ${formatPct(cpu.summary.topRequestEntry.totalPct)}`,
        );
      }
      lines.push('  Top hotspots:');
      this.renderHotspots(lines, cpu.hotspots ?? [], '    ');
      lines.push('');
    }

    const memory = report.profiles?.memory;
    if (memory) {
      lines.push('Memory');
      lines.push(`  Quality: ${memory.quality?.confidence ?? 'unknown'}`);
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
    const topHotspots = hotspots.slice(0, 5);
    if (topHotspots.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const hotspot of topHotspots) {
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
    const topAllocators = allocators.slice(0, 5);
    if (topAllocators.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const allocator of topAllocators) {
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
    const topOperations = operations.slice(0, 5);
    if (topOperations.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const operation of topOperations) {
      lines.push(
        `${indent}#${operation.asyncId} ${operation.kind} (${formatMs(operation.durationMs)}, run ${formatMs(operation.runMs)})`,
      );
      if (operation.userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(operation.userCaller)}`);
      }
    }
  }

  private renderAsyncHotFiles(lines: string[], hotFiles: AsyncHotFile[], indent: string): void {
    const topHotFiles = hotFiles.slice(0, 5);
    if (topHotFiles.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const hotFile of topHotFiles) {
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
    const topChains = chains.slice(0, 5);
    if (topChains.length === 0) {
      lines.push(`${indent}None`);
      return;
    }
    for (const chain of topChains) {
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
    for (const finding of findings) {
      lines.push(`${indent}[${finding.severity}] ${finding.title}`);
      lines.push(`${indent}  ${finding.suggestion}`);
      lines.push(
        `${indent}  Evidence: ${finding.evidence.function} (${formatFrameLocation(finding.evidence)})`,
      );
      const userCaller = userCallerFromEvidenceExtra(finding.evidence.extra);
      if (userCaller) {
        lines.push(`${indent}  User caller: ${formatUserCaller(userCaller)}`);
      }
      const candidateCallers = candidateCallersFromEvidenceExtra(finding.evidence.extra);
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

function sameFrameLocation(
  left: { function?: string; file: string; line: number; source?: { file: string; line: number } },
  right:
    | { function?: string; file: string; line: number; source?: { file: string; line: number } }
    | undefined,
): boolean {
  if (!right) return false;
  return (
    formatFrameLocation(left) === formatFrameLocation(right) && left.function === right.function
  );
}

function userCallerFromEvidenceExtra(extra: unknown): UserCallerAttribution | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  return (extra as { userCaller?: UserCallerAttribution }).userCaller;
}

function candidateCallersFromEvidenceExtra(extra: unknown): UserCallerAttribution[] {
  if (!extra || typeof extra !== 'object') return [];
  const candidateCallers = (extra as { candidateCallers?: unknown }).candidateCallers;
  return Array.isArray(candidateCallers) ? (candidateCallers as UserCallerAttribution[]) : [];
}
