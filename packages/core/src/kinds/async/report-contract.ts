import { asyncProfileReportSchema } from '../../report/schema/async-profile.js';
import type { AsyncProfileReport } from '../../report/types.js';

export { asyncProfileReportSchema };

export function parseAsyncProfileReport(report: unknown): AsyncProfileReport {
  return asyncProfileReportSchema.parse(report);
}
