import type { AnalysisOptions } from '../analysis/core/types.js';
import type { CaptureBundle } from '../capture/core/types.js';
import type { ReportMeta } from './types.js';
import { LANTERNA_VERSION } from './version.generated.js';

/**
 * Report schema version. Schema v2 (2.0.0) restructures CPU data under
 * `report.profiles.cpu.*` and introduces `profileKinds` in meta; prior v1
 * kept CPU sections at the root.
 */
export const LANTERNA_REPORT_SCHEMA_VERSION = '2.0.0';

export function buildReportMeta(
  bundle: CaptureBundle,
  profileKinds: string[],
  totalSamples: number,
  opts: AnalysisOptions,
): ReportMeta {
  return {
    schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
    nodeVersion: bundle.target.nodeVersion,
    v8Version: bundle.target.v8Version,
    platform: bundle.target.platform,
    arch: bundle.target.arch,
    pid: bundle.target.pid,
    startedAt: new Date(bundle.startedAtEpoch).toISOString(),
    durationMs: bundle.durationMs,
    sampleIntervalMicros: opts.sampleIntervalMicros,
    totalSamples,
    cwd: bundle.target.cwd,
    command: opts.command,
    lanternaVersion: LANTERNA_VERSION,
    mode: opts.mode ?? 'spawn',
    deep: opts.deep,
    profileKinds: [...profileKinds],
    captureIntegrity: bundle.captureIntegrity,
  };
}
