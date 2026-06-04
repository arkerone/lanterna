import { formatRawNumber } from './values.js';

export function yamlScalar(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'null';
    return formatRawNumber(value);
  }
  if (typeof value === 'boolean') return String(value);
  return yamlString(value);
}

function yamlString(value: string): string {
  if (value === '') return '""';
  if (/^[A-Za-z0-9_./@:-]+$/.test(value) && !/^(true|false|null|~|yes|no|on|off)$/i.test(value)) {
    // Plain scalar safe: no special chars, and not a YAML reserved keyword.
    if (!value.startsWith('-') && !/^\d/.test(value)) return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function yamlInlineList(values: readonly string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.map((entry) => yamlString(entry)).join(', ')}]`;
}

export function appendTable(lines: string[], headers: string[], rows: string[][]): void {
  const escaped = rows.map((row) => row.map(escapeCell));
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...escaped.map((row) => (row[columnIndex] ?? '').length)),
  );
  const widthAt = (columnIndex: number): number => widths[columnIndex] ?? 0;
  lines.push(
    `| ${headers.map((header, columnIndex) => pad(header, widthAt(columnIndex))).join(' | ')} |`,
  );
  lines.push(`| ${widths.map((width) => '-'.repeat(Math.max(3, width))).join(' | ')} |`);
  for (const row of escaped) {
    lines.push(`| ${row.map((cell, index) => pad(cell ?? '', widthAt(index))).join(' | ')} |`);
  }
}

export function appendIndentedTable(lines: string[], headers: string[], rows: string[][]): void {
  const buffer: string[] = [];
  appendTable(buffer, headers, rows);
  for (const line of buffer) lines.push(`  ${line}`);
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}
