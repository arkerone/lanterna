#!/usr/bin/env node
// Generate runtime assets after tsc and copy test fixtures when needed.
import { cp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const destArg = process.argv.find((a) => a.startsWith('--dest='));
const dest = destArg ? destArg.slice('--dest='.length) : 'dist';
const destRoot = resolve(root, dest);

const hookCoreModule = await import(
  pathToFileURL(resolve(destRoot, 'runtime-signals', 'hooks', 'hook-core.js')).href
);
const preloadHookSource = hookCoreModule.getPreloadHookSource();

const testAssets = [
  ['test/fixtures-profiles', 'dist-test/test/fixtures-profiles'],
];

await writeFile(
  resolve(destRoot, 'runtime-signals', 'hooks', 'event-loop-hook.cjs'),
  preloadHookSource,
  'utf8',
);

// When called with --dest (test mode), also copy test fixtures
if (destArg) {
  for (const [from, to] of testAssets) {
    await cp(resolve(root, from), resolve(root, to), { recursive: true, force: true });
  }
}
