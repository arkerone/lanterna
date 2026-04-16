#!/usr/bin/env node
// Generate runtime hook asset after tsc.
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const distRoot = resolve(packageRoot, 'dist');

const hookCoreModule = await import(
  pathToFileURL(resolve(distRoot, 'runtime-signals', 'hooks', 'hook-core.js')).href
);
const preloadHookSource = hookCoreModule.getPreloadHookSource();

await writeFile(
  resolve(distRoot, 'runtime-signals', 'hooks', 'event-loop-hook.cjs'),
  preloadHookSource,
  'utf8',
);
