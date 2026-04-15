#!/usr/bin/env node
// Copy JS runtime assets (preload hooks) from src/ to dist/ after tsc.
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const destArg = process.argv.find((a) => a.startsWith('--dest='));
const dest = destArg ? destArg.slice('--dest='.length) : 'dist';

// Assets for the main build (dist/)
const mainAssets = [
  ['src/collector/measures/event-loop-hook.cjs', 'dist/collector/measures/event-loop-hook.cjs'],
];

// Additional assets only needed for the test build
const testAssets = [
  ['test/fixtures-profiles', 'dist-test/test/fixtures-profiles'],
];

for (const [from, to] of mainAssets) {
  await cp(resolve(root, from), resolve(root, to), { force: true });
}

// When called with --dest (test mode), also copy test fixtures
if (destArg) {
  for (const [from, to] of testAssets) {
    await cp(resolve(root, from), resolve(root, to), { recursive: true, force: true });
  }
}
