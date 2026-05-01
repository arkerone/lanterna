import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  createAwaitTransformCjsRuntimeSource,
  transformAwaitExpressions,
} from '../src/runtime-signals/hooks/installers/await-transform.js';

const requireForTest = createRequire(import.meta.url);

describe('await transform', () => {
  it('wraps a simple await expression with a stable frame', () => {
    const result = transformAwaitExpressions('async function main() { await foo(); }\n', {
      file: 'file:///app/main.mjs',
    });

    expect(result.stats).toMatchObject({
      transformed: 1,
      skipped: 0,
      failed: 0,
      partial: false,
      awaitCalls: 1,
    });
    expect(result.code).toContain(
      'await globalThis.__LANTERNA_ASYNC_AWAIT__((foo()), {"function":"<await>","file":"file:///app/main.mjs","line":1,"column":25})',
    );
  });

  it('wraps top-level await and conditional await operands', () => {
    const source = [
      'await bootstrap();',
      'async function pick(cond) {',
      '  return await (cond ? a() : b());',
      '}',
    ].join('\n');

    const result = transformAwaitExpressions(source, { file: 'file:///app/module.mjs' });

    expect(result.stats.awaitCalls).toBe(2);
    expect(result.code).toContain(
      'await globalThis.__LANTERNA_ASYNC_AWAIT__((bootstrap()), {"function":"<await>","file":"file:///app/module.mjs","line":1,"column":1})',
    );
    expect(result.code).toContain(
      'await globalThis.__LANTERNA_ASYNC_AWAIT__(((cond ? a() : b())), {"function":"<await>","file":"file:///app/module.mjs","line":3,"column":10})',
    );
  });

  it('wraps nested await expressions independently', () => {
    const source = 'async function main() { return await outer(await inner()); }';

    const result = transformAwaitExpressions(source, { file: 'file:///app/nested.mjs' });

    expect(result.stats.awaitCalls).toBe(2);
    expect(result.code.match(/__LANTERNA_ASYNC_AWAIT__/g)).toHaveLength(2);
    expect(result.code).toContain('outer(await globalThis.__LANTERNA_ASYNC_AWAIT__((inner())');
  });

  it('parses .cjs sources as CommonJS', () => {
    const source = 'exports.run = async function run() { await work(); };';

    const result = transformAwaitExpressions(source, { file: '/app/worker.cjs' });

    expect(result.stats).toMatchObject({
      transformed: 1,
      failed: 0,
      partial: false,
      awaitCalls: 1,
    });
    expect(result.code).toContain('__LANTERNA_ASYNC_AWAIT__');
  });

  it('does not rewrite await-like text in comments, templates, strings, or regex literals', () => {
    const source = [
      'async function main() {',
      '  const text = `await nope`;',
      '  const str = "await nope";',
      '  const re = /await\\s+nope/;',
      '  // await nope',
      '  return await foo();',
      '}',
    ].join('\n');

    const result = transformAwaitExpressions(source, { file: '/app/main.js' });

    expect(result.stats.awaitCalls).toBe(1);
    expect(result.code.match(/__LANTERNA_ASYNC_AWAIT__/g)).toHaveLength(1);
    expect(result.code).toContain('`await nope`');
    expect(result.code).toContain('/await\\s+nope/');
  });

  it('returns original source and marks partial when parsing fails', () => {
    const source = 'async function broken() { await ;';

    const result = transformAwaitExpressions(source, { file: '/app/broken.js' });

    expect(result.code).toBe(source);
    expect(result.stats).toMatchObject({
      transformed: 0,
      skipped: 0,
      failed: 1,
      partial: true,
      awaitCalls: 0,
    });
  });

  it('generates a CommonJS runtime transform for preload hooks', () => {
    const runtimeSource = createAwaitTransformCjsRuntimeSource({
      oxcParserPath: requireForTest.resolve('oxc-parser'),
      magicStringPath: requireForTest.resolve('magic-string'),
    });
    const transform = new Function(
      'require',
      `${runtimeSource}\nreturn transformAwaitExpressions;`,
    )(requireForTest) as typeof transformAwaitExpressions;

    const result = transform('async function main() { await work(); }', {
      file: '/app/main.cjs',
      sourceType: 'commonjs',
    });

    expect(result.stats.awaitCalls).toBe(1);
    expect(result.code).toContain('__LANTERNA_ASYNC_AWAIT__');
  });
});
