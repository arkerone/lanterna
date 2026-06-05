import { writeReportDiffOutput } from '../output.js';
import type { DiffOptions } from '../parse.js';

export async function diffCommand(options: DiffOptions): Promise<void> {
  await writeReportDiffOutput(
    options.baseline,
    options.current,
    options.output,
    options.pretty,
    options.format,
  );
}
