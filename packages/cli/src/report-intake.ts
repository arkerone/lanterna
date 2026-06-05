import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildReportSchema,
  createAsyncProfileKind,
  createCpuProfileKind,
  createMemoryProfileKind,
  LANTERNA_REPORT_SCHEMA_VERSION,
  type LanternaReport,
} from '@lanterna-profiler/core';

const genericReportSchema = buildReportSchema([
  createCpuProfileKind({ readStderrSoFar: () => '' }),
  createMemoryProfileKind(),
  createAsyncProfileKind(),
]);

export async function readLanternaReport(
  reportPath: string,
  label = 'Lanterna report',
): Promise<LanternaReport> {
  const raw = await readFile(resolve(reportPath), 'utf8');
  const parsed = parseReportJson(raw, reportPath, label);
  const result = genericReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid ${label} "${reportPath}": ${formatSchemaIssues(result.error.issues)}`);
  }
  const report = result.data as LanternaReport;
  assertSupportedSchemaVersion(report, reportPath, label);
  return report;
}

function parseReportJson(raw: string, reportPath: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${label} "${reportPath}": ${message}`);
  }
}

function assertSupportedSchemaVersion(
  report: LanternaReport,
  reportPath: string,
  label: string,
): void {
  if (report.meta.schemaVersion === LANTERNA_REPORT_SCHEMA_VERSION) return;
  throw new Error(
    `Unsupported Lanterna report schema version in ${label} "${reportPath}": ${report.meta.schemaVersion}; expected ${LANTERNA_REPORT_SCHEMA_VERSION}`,
  );
}

function formatSchemaIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string {
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}
