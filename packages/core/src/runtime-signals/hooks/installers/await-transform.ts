import MagicString from 'magic-string';
import { type ParserOptions, parseSync, visitorKeys } from 'oxc-parser';

export interface AwaitTransformStats {
  transformed: number;
  skipped: number;
  failed: number;
  partial: boolean;
  awaitCalls: number;
}

export interface AwaitTransformResult {
  code: string;
  stats: AwaitTransformStats;
}

export interface AwaitTransformOptions {
  file: string;
  sourceType?: ParserOptions['sourceType'];
}

export function createAwaitTransformEsmRuntimeSource(options: {
  oxcParserUrl: string;
  magicStringUrl: string;
}): string {
  return [
    `import { parseSync, visitorKeys } from ${JSON.stringify(options.oxcParserUrl)};`,
    `import MagicString from ${JSON.stringify(options.magicStringUrl)};`,
    createAwaitTransformFunctionRuntimeSource(),
  ].join('\n');
}

export function createAwaitTransformCjsRuntimeSource(options: {
  oxcParserPath: string;
  magicStringPath: string;
}): string {
  return [
    `const { parseSync, visitorKeys } = require(${JSON.stringify(options.oxcParserPath)});`,
    `const MagicStringModule = require(${JSON.stringify(options.magicStringPath)});`,
    'const MagicString = MagicStringModule.default || MagicStringModule;',
    createAwaitTransformFunctionRuntimeSource(),
  ].join('\n');
}

interface AstNode {
  type?: string;
  start?: number;
  end?: number;
  argument?: AstNode;
  [key: string]: unknown;
}

export function transformAwaitExpressions(
  source: string,
  options: AwaitTransformOptions,
): AwaitTransformResult {
  const stats: AwaitTransformStats = {
    transformed: 0,
    skipped: 0,
    failed: 0,
    partial: false,
    awaitCalls: 0,
  };

  let program: AstNode;
  try {
    const parsed = parseSync(options.file, source, {
      range: true,
      sourceType: options.sourceType ?? inferSourceType(options.file),
    });
    if (parsed.errors.some((error) => error.severity === 'Error')) {
      stats.failed = 1;
      stats.partial = true;
      return { code: source, stats };
    }
    program = parsed.program as unknown as AstNode;
  } catch {
    stats.failed = 1;
    stats.partial = true;
    return { code: source, stats };
  }

  const awaits: Array<{ start: number; end: number; argumentStart: number; argumentEnd: number }> =
    [];
  collectAwaitExpressions(program, awaits);
  if (awaits.length === 0) {
    stats.skipped = 1;
    return { code: source, stats };
  }

  const lineStarts = computeLineStarts(source);
  const output = new MagicString(source);
  for (const awaitNode of awaits) {
    const frame = JSON.stringify({
      function: '<await>',
      file: options.file,
      ...offsetToLocation(lineStarts, awaitNode.start),
    });
    output.overwrite(
      awaitNode.start,
      awaitNode.argumentStart,
      'await globalThis.__LANTERNA_ASYNC_AWAIT__((',
    );
    output.appendRight(awaitNode.argumentEnd, `), ${frame})`);
  }

  const code = output.toString();
  stats.awaitCalls = awaits.length;
  stats.transformed = code === source ? 0 : 1;
  stats.skipped = code === source ? 1 : 0;
  return { code, stats };
}

function inferSourceType(file: string): ParserOptions['sourceType'] {
  if (file.endsWith('.cjs')) return 'commonjs';
  if (file.endsWith('.mjs')) return 'module';
  return 'unambiguous';
}

function collectAwaitExpressions(
  node: AstNode | AstNode[] | null | undefined,
  out: Array<{ start: number; end: number; argumentStart: number; argumentEnd: number }>,
): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) collectAwaitExpressions(child, out);
    return;
  }
  if (typeof node !== 'object') return;

  if (
    node.type === 'AwaitExpression' &&
    typeof node.start === 'number' &&
    typeof node.end === 'number' &&
    typeof node.argument?.start === 'number' &&
    typeof node.argument.end === 'number'
  ) {
    out.push({
      start: node.start,
      end: node.end,
      argumentStart: node.argument.start,
      argumentEnd: node.argument.end,
    });
  }

  const keys = node.type ? visitorKeys[node.type] : undefined;
  if (keys) {
    for (const key of keys) {
      collectAwaitExpressions(node[key] as AstNode | AstNode[] | null | undefined, out);
    }
  }
}

function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLocation(lineStarts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    if (lineStart <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] ?? 0) + 1,
  };
}

function createAwaitTransformFunctionRuntimeSource(): string {
  return `
function inferSourceType(file) {
  if (file.endsWith('.cjs')) return 'commonjs';
  if (file.endsWith('.mjs')) return 'module';
  return 'unambiguous';
}
function collectAwaitExpressions(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) collectAwaitExpressions(child, out);
    return;
  }
  if (typeof node !== 'object') return;
  if (
    node.type === 'AwaitExpression' &&
    typeof node.start === 'number' &&
    typeof node.end === 'number' &&
    typeof node.argument?.start === 'number' &&
    typeof node.argument.end === 'number'
  ) {
    out.push({
      start: node.start,
      end: node.end,
      argumentStart: node.argument.start,
      argumentEnd: node.argument.end,
    });
  }
  const keys = node.type ? visitorKeys[node.type] : undefined;
  if (keys) {
    for (const key of keys) collectAwaitExpressions(node[key], out);
  }
}
function computeLineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}
function offsetToLocation(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lineStart = lineStarts[mid] ?? 0;
    if (lineStart <= offset) low = mid + 1;
    else high = mid - 1;
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] ?? 0) + 1,
  };
}
function transformAwaitExpressions(source, options) {
  const stats = {
    transformed: 0,
    skipped: 0,
    failed: 0,
    partial: false,
    awaitCalls: 0,
  };
  let program;
  try {
    const parsed = parseSync(options.file, source, {
      range: true,
      sourceType: options.sourceType ?? inferSourceType(options.file),
    });
    if (parsed.errors.some((error) => error.severity === 'Error')) {
      stats.failed = 1;
      stats.partial = true;
      return { code: source, stats };
    }
    program = parsed.program;
  } catch {
    stats.failed = 1;
    stats.partial = true;
    return { code: source, stats };
  }
  const awaits = [];
  collectAwaitExpressions(program, awaits);
  if (awaits.length === 0) {
    stats.skipped = 1;
    return { code: source, stats };
  }
  const lineStarts = computeLineStarts(source);
  const output = new MagicString(source);
  for (const awaitNode of awaits) {
    const frame = JSON.stringify({
      function: '<await>',
      file: options.file,
      ...offsetToLocation(lineStarts, awaitNode.start),
    });
    output.overwrite(
      awaitNode.start,
      awaitNode.argumentStart,
      'await globalThis.__LANTERNA_ASYNC_AWAIT__((',
    );
    output.appendRight(awaitNode.argumentEnd, '), ' + frame + ')');
  }
  const code = output.toString();
  stats.awaitCalls = awaits.length;
  stats.transformed = code === source ? 0 : 1;
  stats.skipped = code === source ? 1 : 0;
  return { code, stats };
}`;
}
