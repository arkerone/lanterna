import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type LanternaReport,
  logger,
  type ProfileKind,
  serializeReport,
} from '@lanterna-profiler/core';
import type { OutputFormat } from './parse.js';
import { renderReport } from './report-renderer.js';

export async function writeReportOutput(
  report: LanternaReport,
  outputPath: string | undefined,
  pretty: boolean,
  format: OutputFormat,
  kinds: ReadonlyArray<ProfileKind>,
): Promise<void> {
  const rendered =
    format === 'json'
      ? serializeReport(report, { pretty, kinds })
      : renderReport(report, { format });
  await writeRenderedOutput(rendered, outputPath);
}

export async function writeExistingReportOutput(
  reportPath: string,
  outputPath: string | undefined,
  pretty: boolean,
  format: OutputFormat,
): Promise<void> {
  const raw = await readFile(resolve(reportPath), 'utf8');
  const parsed = JSON.parse(raw) as LanternaReport;
  const rendered =
    format === 'json'
      ? JSON.stringify(parsed, null, pretty ? 2 : 0)
      : renderReport(parsed, { format });
  await writeRenderedOutput(rendered, outputPath);
}

async function writeRenderedOutput(
  rendered: string,
  outputPath: string | undefined,
): Promise<void> {
  if (outputPath) {
    await writeFile(resolve(outputPath), ensureTrailingNewline(rendered), 'utf8');
    logger.warn({ outputPath }, 'report written');
    return;
  }
  process.stdout.write(ensureTrailingNewline(rendered));
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}
