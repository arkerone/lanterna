import type { AnalysisOptions } from '../analysis/core/types.js';
import type { EnrichedTree } from '../analysis/model/hotspots.js';
import type { RawCapture } from '../capture/core/types.js';
import type { ReportMeta } from './types.js';
import { LANTERNA_VERSION } from './version.generated.js';

/**
 * Current version of the Lanterna JSON report schema. Bump this when the
 * report's consumer-visible shape changes in a way that an agent needs to
 * notice (added fields = patch, renamed/removed = major).
 */
export const LANTERNA_REPORT_SCHEMA_VERSION = '1.0.0';

export function buildReportMeta(
  raw: RawCapture,
  tree: Pick<EnrichedTree, 'totalSamples'>,
  opts: AnalysisOptions,
): ReportMeta {
  return {
    schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
    nodeVersion: raw.target.nodeVersion,
    v8Version: raw.target.v8Version,
    platform: raw.target.platform,
    arch: raw.target.arch,
    pid: raw.target.pid,
    startedAt: new Date(raw.startedAtEpoch).toISOString(),
    durationMs: raw.durationMs,
    sampleIntervalMicros: opts.sampleIntervalMicros,
    totalSamples: tree.totalSamples,
    cwd: raw.target.cwd,
    command: opts.command,
    lanternaVersion: LANTERNA_VERSION,
    mode: opts.mode ?? 'spawn',
    deep: opts.deep,
    captureIntegrity: raw.captureIntegrity,
  };
}
