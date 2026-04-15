import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LanternaReport } from '../report/types.js';
import { serializeReport } from '../report/index.js';
import { logger } from '../shared/logger.js';

export async function writeReportOutput(
  report: LanternaReport,
  outputPath: string | undefined,
  pretty: boolean,
): Promise<void> {
  const json = serializeReport(report, { pretty });
  if (outputPath) {
    await writeFile(resolve(outputPath), `${json}\n`, 'utf8');
    logger.warn({ outputPath }, 'report written');
    return;
  }
  process.stdout.write(`${json}\n`);
}
