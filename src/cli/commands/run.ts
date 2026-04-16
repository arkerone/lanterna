import { startActivityIndicator } from '../activity-indicator.js';
import { runProfile } from '../../profile.js';
import type { RunProfileOptions } from '../parse.js';
import { writeReportOutput } from '../output.js';

export async function runCommand(options: RunProfileOptions): Promise<void> {
  const commandLabel = options.command.join(' ');
  const indicator = startActivityIndicator(`Preparing run workflow for ${commandLabel}...`, {
    keepHistory: true,
  });
  try {
    const report = await runProfile(options, (event) => {
      indicator.update(event.message);
    });
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
