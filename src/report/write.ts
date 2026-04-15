import type { LanternaReport } from './types.js';

export interface WriteOptions {
  pretty: boolean;
}

export function serializeReport(report: LanternaReport, opts: WriteOptions): string {
  return JSON.stringify(report, null, opts.pretty ? 2 : 0);
}
