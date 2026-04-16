import { startActivityIndicator } from '../activity-indicator.js';
import { runProfile, type LanternaDetectorPlugin } from '@lanterna/detectors';
import type { RunProfileOptions } from '../parse.js';
import { writeReportOutput } from '../output.js';
import { loadLanternaConfig } from '../config.js';
import { loadPlugins } from '../plugins.js';

export async function runCommand(options: RunProfileOptions): Promise<void> {
  const commandLabel = options.command.join(' ');
  const indicator = startActivityIndicator(`Preparing run workflow for ${commandLabel}...`, {
    keepHistory: true,
  });
  try {
    const setupPipeline = await resolveSetupPipeline(options.detectors);
    const { detectors: _specs, ...profileOptions } = options;
    const report = await runProfile(
      { ...profileOptions, ...(setupPipeline ? { setupPipeline } : {}) },
      (event) => {
        indicator.update(event.message);
      },
    );
    indicator.update('Writing the Lanterna report output...');
    await writeReportOutput(report, options.output, options.pretty);
    indicator.succeed('Lanterna profile complete');
    if (process.exitCode === 0) {
      process.exit(0);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    indicator.fail(`Lanterna profiling failed: ${message}`);
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
