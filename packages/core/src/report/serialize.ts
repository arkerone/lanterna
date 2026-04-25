import type { ProfileKind } from '../kinds/core/types.js';
import { buildReportSchema } from './schema.js';
import type { LanternaReport } from './types.js';

export interface SerializeReportOptions {
  pretty: boolean;
  kinds: ReadonlyArray<Pick<ProfileKind, 'reportSectionKey' | 'reportSchema'>>;
}

export function serializeReport(report: LanternaReport, options: SerializeReportOptions): string {
  const schema = buildReportSchema(options.kinds);
  const parsed = schema.safeParse(report);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid lanterna report: ${details}`);
  }
  return JSON.stringify(parsed.data, null, options.pretty ? 2 : 0);
}
