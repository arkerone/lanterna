import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type LanternaReport,
  logger,
  type ProfileKind,
  serializeReport,
} from '@lanterna-profiler/core';

export async function writeReportOutput(
  report: LanternaReport,
  outputPath: string | undefined,
  pretty: boolean,
  kinds: ReadonlyArray<ProfileKind>,
): Promise<void> {
  const json = serializeReport(report, { pretty, kinds });
  if (outputPath) {
    await writeFile(resolve(outputPath), `${json}\n`, 'utf8');
    logger.warn({ outputPath }, 'report written');
    return;
  }
  process.stdout.write(`${json}\n`);
}
