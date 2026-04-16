import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

describe('loadPlugins', () => {
  it('returns an empty array when given no specs', async () => {
    expect(await loadPlugins([], process.cwd())).toEqual([]);
  });

  it('loads a relative path plugin', async () => {
    const plugins = await loadPlugins(['./custom-plugin.mjs'], fixturesDir);
    expect(plugins).toHaveLength(1);
    expect(typeof plugins[0]).toBe('function');
  });

  it('loads an absolute path plugin', async () => {
    const abs = resolve(fixturesDir, 'custom-plugin.mjs');
    const plugins = await loadPlugins([abs], process.cwd());
    expect(plugins).toHaveLength(1);
  });

  it('throws a clear error when the module is missing', async () => {
    await expect(loadPlugins(['./does-not-exist.mjs'], fixturesDir)).rejects.toThrow(
      /Failed to load detector plugin "\.\/does-not-exist\.mjs"/,
    );
  });

  it('throws when the default export is not a function', async () => {
    const bad = resolve(fixturesDir, 'bad-plugin.mjs');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(bad, 'export default { not: "a function" };\n'),
    );
    try {
      await expect(loadPlugins([bad], process.cwd())).rejects.toThrow(
        /must export default function\(pipeline, ctx\)/,
      );
    } finally {
      await import('node:fs/promises').then((fs) => fs.rm(bad, { force: true }));
    }
  });
});
