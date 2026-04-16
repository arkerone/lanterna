import { attachProfile } from '../../profile.js';
import type { AttachProfileOptions } from '../parse.js';
import { writeReportOutput } from '../output.js';

export async function attachCommand(options: AttachProfileOptions): Promise<void> {
  const report = await attachProfile(options);
  await writeReportOutput(report, options.output, options.pretty);
  if (process.exitCode === 0) {
    process.exit(0);
  }
}
