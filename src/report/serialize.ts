import type { LanternaReport } from './types.js';
import { lanternaReportSchema } from './schema.js';

export interface SerializeReportOptions {
  pretty: boolean;
}

export function serializeReport(
  report: LanternaReport,
  options: SerializeReportOptions,
): string {
  const parsed = lanternaReportSchema.safeParse(report);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid lanterna report: ${details}`);
  }
  return JSON.stringify(parsed.data, null, options.pretty ? 2 : 0);
}
