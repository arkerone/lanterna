import { writeExistingReportOutput } from '../output.js';
import type { ReportOptions } from '../parse.js';

export async function reportCommand(options: ReportOptions): Promise<void> {
  await writeExistingReportOutput(options.file, options.output, options.pretty, options.format);
}
