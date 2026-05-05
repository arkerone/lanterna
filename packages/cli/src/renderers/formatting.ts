/** Shared, format-agnostic value formatters used by every renderer. */

import type { UserCallerAttribution } from '@lanterna-profiler/core';

export function formatCommand(command: string[] | undefined): string {
  if (!command || command.length === 0) return '(unknown)';
  return command.join(' ');
}

export function formatMs(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${Math.round(value)}ms`;
}

export function formatRatio(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return formatPct(value * 100);
}

export function formatPct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  return `${value.toFixed(fractionDigitsForPct(value))}%`;
}

function fractionDigitsForPct(value: number): number {
  if (value >= 10) return 1;
  return 2;
}

export function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

export function formatLocation(file: string, line: number): string {
  return `${file}:${line}`;
}

/**
 * Render a frame's location, preferring the resolved source position when
 * present. The generated `(file:line)` is appended in parens so consumers can
 * still see where V8 sampled — useful when the source mapping is suspect.
 */
export function formatFrameLocation(frame: {
  file: string;
  line: number;
  source?: { file: string; line: number };
}): string {
  if (frame.source) {
    return `${frame.source.file}:${frame.source.line} (${frame.file}:${frame.line})`;
  }
  return formatLocation(frame.file, frame.line);
}

export function formatUserCaller(caller: UserCallerAttribution): string {
  return `${caller.function} (${formatFrameLocation(caller)}) [${caller.confidence}, support ${formatPct(caller.supportPct)}]`;
}

export function formatEventLoop(
  eventLoop: { available?: boolean; p99LagMs?: number; maxLagMs?: number } | undefined,
): string {
  if (!eventLoop?.available) return 'unavailable';
  return `p99 ${formatMs(eventLoop.p99LagMs)}, max ${formatMs(eventLoop.maxLagMs)}`;
}
