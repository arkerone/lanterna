/** Shared, format-agnostic value formatters used by every renderer. */

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

export function formatEventLoop(
  eventLoop: { available?: boolean; p99LagMs?: number; maxLagMs?: number } | undefined,
): string {
  if (!eventLoop?.available) return 'unavailable';
  return `p99 ${formatMs(eventLoop.p99LagMs)}, max ${formatMs(eventLoop.maxLagMs)}`;
}
