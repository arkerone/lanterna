import { runProfile } from '../../profile.js';
import type { RunProfileOptions } from '../parse.js';
import { writeReportOutput } from '../output.js';

export async function runCommand(options: RunProfileOptions): Promise<void> {
  const report = await runProfile(options);
  await writeReportOutput(report, options.output, options.pretty);
  if (process.exitCode === 0) {
    process.exit(0);
  }
}
