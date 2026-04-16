import { startActivityIndicator } from '../activity-indicator.js';
import { resolveAttachTarget } from '../attach-target.js';
import { attachProfile, type LanternaDetectorPlugin } from '@lanterna/detectors';
import type { AttachProfileOptions } from '../parse.js';
import { writeReportOutput } from '../output.js';
import { loadLanternaConfig } from '../config.js';
import { loadPlugins } from '../plugins.js';

export async function attachCommand(options: AttachProfileOptions): Promise<void> {
  const resolvedOptions = await resolveAttachTarget(options);
  const targetLabel = resolvedOptions.inspectUrl !== undefined
    ? 'the provided inspector endpoint'
    : `pid ${resolvedOptions.pid ?? 'unknown'}`;
  const indicator = startActivityIndicator(`Preparing attach workflow for ${targetLabel}...`, {
    keepHistory: true,
  });
  try {
    const setupPipeline = await resolveSetupPipeline(resolvedOptions.detectors);
    const { detectors: _specs, ...profileOptions } = resolvedOptions;
    const report = await attachProfile(
      { ...profileOptions, ...(setupPipeline ? { setupPipeline } : {}) },
      (event) => {
        indicator.update(event.message);
      },
    );
    indicator.update('Writing the Lanterna report output...');
    await writeReportOutput(report, resolvedOptions.output, resolvedOptions.pretty);
    indicator.succeed('Lanterna attach capture complete');
    if (process.exitCode === 0) {
      process.exit(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    indicator.fail(`Lanterna attach capture failed: ${message}`);
    if (error && typeof error === 'object') {
      Reflect.set(error, 'lanternaReported', true);
    }
    throw error;
  }
}

async function resolveSetupPipeline(
  flagSpecs: string[],
): Promise<LanternaDetectorPlugin | undefined> {
  const cwd = process.cwd();
  const config = await loadLanternaConfig(cwd);
  const specs = [...(config?.detectors ?? []), ...flagSpecs];
  if (specs.length === 0) return undefined;
  const plugins = await loadPlugins(specs, cwd);
  return async (pipeline, ctx) => {
    for (const plugin of plugins) {
      await plugin(pipeline, ctx);
    }
  };
}
