import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type LanternaReport,
  logger,
  type ProfileKind,
  serializeReport,
} from '@lanterna-profiler/core';
import { diffReports } from './diff/diff-report.js';
import { renderDiff } from './diff/render-diff.js';
import type { OutputFormat } from './parse.js';
import { renderReport } from './renderers/index.js';
import { readLanternaReport } from './report-intake.js';

export async function writeReportOutput(
  report: LanternaReport,
  outputPath: string | undefined,
  pretty: boolean,
  format: OutputFormat,
  kinds: ReadonlyArray<ProfileKind>,
): Promise<void> {
  const rendered = renderCapturedReport(report, pretty, format, kinds);
  await writeRenderedOutput(rendered, outputPath);
}

export async function writeExistingReportOutput(
  reportPath: string,
  outputPath: string | undefined,
  pretty: boolean,
  format: OutputFormat,
): Promise<void> {
  const parsed = await readLanternaReport(reportPath);
  const rendered = renderExistingReport(parsed, pretty, format);
  await writeRenderedOutput(rendered, outputPath);
}

export async function writeReportDiffOutput(
  baselinePath: string,
  currentPath: string,
  outputPath: string | undefined,
  pretty: boolean,
  format: OutputFormat,
): Promise<void> {
  const baseline = await readLanternaReport(baselinePath, 'baseline report');
  const current = await readLanternaReport(currentPath, 'current report');
  const rendered = renderDiff(diffReports(baseline, current), format, pretty);
  await writeRenderedOutput(rendered, outputPath);
}

function renderCapturedReport(
  report: LanternaReport,
  pretty: boolean,
  format: OutputFormat,
  kinds: ReadonlyArray<ProfileKind>,
): string {
  if (format === 'json') {
    return serializeReport(report, { pretty, kinds });
  }
  return renderReport(report, { format });
}

function renderExistingReport(
  report: LanternaReport,
  pretty: boolean,
  format: OutputFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(report, null, jsonIndent(pretty));
  }
  return renderReport(report, { format });
}

function jsonIndent(pretty: boolean): number {
  if (pretty) return 2;
  return 0;
}

async function writeRenderedOutput(
  rendered: string,
  outputPath: string | undefined,
): Promise<void> {
  if (outputPath) {
    await writeFile(resolve(outputPath), ensureTrailingNewline(rendered), 'utf8');
    logger.debug({ outputPath }, 'report written');
    return;
  }
  process.stdout.write(ensureTrailingNewline(rendered));
}

function ensureTrailingNewline(value: string): string {
  if (value.endsWith('\n')) return value;
  return `${value}\n`;
}
