import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LanternaDetectorPlugin } from '@lanterna/detectors';

export async function loadPlugins(
  specs: string[],
  cwd: string,
): Promise<LanternaDetectorPlugin[]> {
  const plugins: LanternaDetectorPlugin[] = [];
  for (const spec of specs) {
    const url = isLocalPath(spec) ? pathToFileURL(resolve(cwd, spec)).href : spec;
    let mod: { default?: unknown };
    try {
      mod = (await import(url)) as { default?: unknown };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load detector plugin "${spec}": ${message}`);
    }
    if (typeof mod.default !== 'function') {
      throw new Error(
        `detector plugin "${spec}" must export default function(pipeline, ctx)`,
      );
    }
    plugins.push(mod.default as LanternaDetectorPlugin);
  }
  return plugins;
}

function isLocalPath(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('.\\') || spec.startsWith('..\\') || isAbsolute(spec);
}
