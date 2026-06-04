import type { LanternaReport } from '@lanterna-profiler/core';
import { formatCommand } from '../formatting.js';
import {
  blockingIntegrityCaveats,
  degradingSignalCaveats,
  hasInsufficientSignal,
} from './caveats.js';
import { yamlInlineList, yamlScalar } from './markdown.js';
import { formatRatio01 } from './values.js';

export function appendFrontmatter(lines: string[], report: LanternaReport): void {
  const meta = report.meta;
  const integrity = meta?.captureIntegrity;
  const sourceMaps = integrity?.sourceMaps;
  const blockingCaveats = blockingIntegrityCaveats(report);
  const degradingCaveats = degradingSignalCaveats(report);

  lines.push('---');
  lines.push(`mode: ${yamlScalar(meta?.mode ?? 'unknown')}`);
  lines.push(`pid: ${yamlScalar(meta?.pid)}`);
  lines.push(`command: ${yamlScalar(formatCommand(meta?.command))}`);
  lines.push(`duration_ms: ${yamlScalar(meta?.durationMs)}`);
  lines.push(`cwd: ${yamlScalar(meta?.cwd ?? 'unknown')}`);
  lines.push(`kinds: ${yamlInlineList(meta?.profileKinds ?? [])}`);
  lines.push(`lanterna_version: ${yamlScalar(meta?.lanternaVersion ?? 'unknown')}`);
  lines.push(`cpu_quality: ${yamlScalar(report.profiles?.cpu?.quality?.confidence ?? 'absent')}`);
  lines.push(
    `memory_quality: ${yamlScalar(report.profiles?.memory?.quality?.confidence ?? 'absent')}`,
  );
  lines.push(`memory_signal: ${yamlScalar(memorySignalLabel(report.profiles?.memory))}`);
  lines.push(
    `async_quality: ${yamlScalar(report.profiles?.async?.quality?.confidence ?? 'absent')}`,
  );
  lines.push(`integrity: ${yamlScalar(integrityLabel(integrity, blockingCaveats))}`);
  lines.push(`rerun_required: ${yamlScalar(hasInsufficientSignal(report))}`);
  if (sourceMaps?.enabled) {
    lines.push(`sourcemap_coverage: ${formatRatio01(sourceMaps.coverage)}`);
    if (sourceMaps.status !== undefined) {
      lines.push(`sourcemap_status: ${yamlScalar(sourceMaps.status)}`);
    }
    lines.push(`sourcemap_maps_loaded: ${yamlScalar(sourceMaps.mapsLoaded)}`);
  } else {
    lines.push('sourcemap_coverage: null');
  }
  lines.push(`blocking_caveats: ${yamlInlineList(blockingCaveats)}`);
  lines.push(`degrading_caveats: ${yamlInlineList(degradingCaveats)}`);
  lines.push('---');
}

function memorySignalLabel(memory: { memoryUsage?: { available?: boolean } } | undefined): string {
  if (!memory) return 'absent';
  const usage = memory.memoryUsage;
  if (usage?.available === false) return 'usage-unavailable';
  return 'present';
}

function integrityLabel(
  integrity: LanternaReport['meta']['captureIntegrity'] | undefined,
  blockingCaveats: readonly string[],
): string {
  if (!integrity) return 'unknown';
  if (blockingCaveats.length === 0) return 'ok';
  return 'degraded';
}
