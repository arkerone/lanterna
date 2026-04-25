import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProfileKind } from '@lanterna-profiler/core';
import type { LanternaDetectorPlugin } from '@lanterna-profiler/detectors';

/**
 * What a Lanterna CLI plugin module can contribute. A single npm package can:
 * - register one or more {@link ProfileKind}s under `kinds` (so `--kind <id>`
 *   resolves them), and/or
 * - register pipeline-level analyzers via the default-exported
 *   {@link LanternaDetectorPlugin}.
 *
 * Both fields are optional. A pure detector pack uses only `default`; a kind
 * pack with its own detectors typically only needs `kinds` (the kind itself
 * carries `builtInAnalyzers`).
 */
export interface LanternaPluginModule {
  default?: LanternaDetectorPlugin;
  kinds?: readonly ProfileKind[];
}

export interface LoadedPlugins {
  kinds: ProfileKind[];
  setups: LanternaDetectorPlugin[];
}

export async function loadPlugins(specs: string[], cwd: string): Promise<LoadedPlugins> {
  const kinds: ProfileKind[] = [];
  const setups: LanternaDetectorPlugin[] = [];
  for (const spec of specs) {
    const url = isLocalPath(spec) ? pathToFileURL(resolve(cwd, spec)).href : spec;
    let mod: LanternaPluginModule;
    try {
      mod = (await import(url)) as LanternaPluginModule;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load detector plugin "${spec}": ${message}`);
    }
    const hasSetup = typeof mod.default === 'function';
    const hasKinds = Array.isArray(mod.kinds) && mod.kinds.length > 0;
    if (!hasSetup && !hasKinds) {
      throw new Error(
        `detector plugin "${spec}" must export default function(pipeline, ctx) and/or named "kinds: ProfileKind[]"`,
      );
    }
    if (hasSetup) setups.push(mod.default as LanternaDetectorPlugin);
    if (hasKinds) kinds.push(...(mod.kinds as ProfileKind[]));
  }
  return { kinds, setups };
}

function isLocalPath(spec: string): boolean {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('.\\') ||
    spec.startsWith('..\\') ||
    isAbsolute(spec)
  );
}
