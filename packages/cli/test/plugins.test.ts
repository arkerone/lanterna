import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

describe('loadPlugins', () => {
  it('returns empty contributions when given no specs', async () => {
    expect(await loadPlugins([], process.cwd())).toEqual({ kinds: [], setups: [] });
  });

  it('loads a relative path plugin', async () => {
    const { setups, kinds } = await loadPlugins(['./custom-plugin.mjs'], fixturesDir);
    expect(setups).toHaveLength(1);
    expect(typeof setups[0]).toBe('function');
    expect(kinds).toHaveLength(0);
  });

  it('loads an absolute path plugin', async () => {
    const abs = resolve(fixturesDir, 'custom-plugin.mjs');
    const { setups } = await loadPlugins([abs], process.cwd());
    expect(setups).toHaveLength(1);
  });

  it('throws a clear error when the module is missing', async () => {
    await expect(loadPlugins(['./does-not-exist.mjs'], fixturesDir)).rejects.toThrow(
      /Failed to load detector plugin "\.\/does-not-exist\.mjs"/,
    );
  });

  it('throws when the module exposes neither a default function nor kinds', async () => {
    const bad = resolve(fixturesDir, 'bad-plugin.mjs');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(bad, 'export default { not: "a function" };\n'),
    );
    try {
      await expect(loadPlugins([bad], process.cwd())).rejects.toThrow(
        /must export default function\(pipeline, ctx\) and\/or named "kinds: ProfileKind\[\]"/,
      );
    } finally {
      await import('node:fs/promises').then((fs) => fs.rm(bad, { force: true }));
    }
  });

  it('loads a plugin module that exposes only `kinds`', async () => {
    const kindsPlugin = resolve(fixturesDir, 'kinds-only-plugin.mjs');
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(
        kindsPlugin,
        `export const kinds = [{
  id: 'fake',
  reportSectionKey: 'fake',
  reportSchema: { safeParse: () => ({ success: true, data: undefined }) },
  createProbe: () => ({ start: async () => {}, stop: async () => ({}) }),
  createAnalysisContributor: () => ({ analyze: () => {} }),
}];\n`,
      ),
    );
    try {
      const { setups, kinds } = await loadPlugins([kindsPlugin], process.cwd());
      expect(setups).toHaveLength(0);
      expect(kinds).toHaveLength(1);
      expect(kinds[0]?.id).toBe('fake');
    } finally {
      await import('node:fs/promises').then((fs) => fs.rm(kindsPlugin, { force: true }));
    }
  });
});
