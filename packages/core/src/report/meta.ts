import type { AnalysisOptions } from '../analysis/core/types.js';
import type { EnrichedTree } from '../analysis/model/hotspots.js';
import type { RawCapture } from '../capture/core/types.js';
import type { ReportMeta } from './types.js';
import { LANTERNA_VERSION } from './version.generated.js';

export function buildReportMeta(
  raw: RawCapture,
  tree: Pick<EnrichedTree, 'totalSamples'>,
  opts: AnalysisOptions,
): ReportMeta {
  return {
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
