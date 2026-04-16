import { startActivityIndicator } from '../activity-indicator.js';
import { resolveAttachTarget } from '../attach-target.js';
import { attachProfile } from '../../profile.js';
import type { AttachProfileOptions } from '../parse.js';
import { writeReportOutput } from '../output.js';

export async function attachCommand(options: AttachProfileOptions): Promise<void> {
  const resolvedOptions = await resolveAttachTarget(options);
  const targetLabel = resolvedOptions.inspectUrl !== undefined
    ? 'the provided inspector endpoint'
    : `pid ${resolvedOptions.pid ?? 'unknown'}`;
  const indicator = startActivityIndicator(`Preparing attach workflow for ${targetLabel}...`, {
    keepHistory: true,
  });
  try {
    const report = await attachProfile(resolvedOptions, (event) => {
      indicator.update(event.message);
    });
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
