/**
 * Schema-agnostic walker. Renders any JSON-shaped value as indented
 * `key: value` lines (objects) and `- item` lines (arrays), with
 * primitives inlined and nested structures recursed into.
 *
 * Used to surface detector-supplied `evidence.extra` payloads without
 * the renderer having to know about specific finding categories.
 */
export function renderValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [String(value)];
  if (Array.isArray(value)) return renderArray(value);
  return renderObject(value as Record<string, unknown>);
}

function renderArray(items: unknown[]): string[] {
  if (items.length === 0) return [];
  const lines: string[] = [];
  for (const item of items) {
    const sub = renderValue(item);
    if (sub.length === 0) {
      lines.push('- (empty)');
      continue;
    }
    lines.push(`- ${sub[0]}`);
    for (const line of sub.slice(1)) lines.push(`  ${line}`);
  }
  return lines;
}

function renderObject(obj: Record<string, unknown>): string[] {
  const lines: string[] = [];
  for (const [key, child] of Object.entries(obj)) {
    if (child === undefined || child === null) continue;
    if (typeof child !== 'object') {
      lines.push(`${key}: ${String(child)}`);
      continue;
    }
    if (Array.isArray(child) && child.every((x) => x === null || typeof x !== 'object')) {
      lines.push(`${key}: [${child.map((x) => (x === null ? 'null' : String(x))).join(', ')}]`);
      continue;
    }
    const sub = renderValue(child);
    if (sub.length === 0) continue;
    lines.push(`${key}:`);
    for (const line of sub) lines.push(`  ${line}`);
  }
  return lines;
}
