import type { AnalysisOptions } from '../analysis/core/types.js';
import type { CaptureBundle } from '../capture/core/types.js';
import type { ProfileKind } from '../kinds/core/types.js';
import type { ReportMeta } from './types.js';
import { LANTERNA_VERSION } from './version.generated.js';

/**
 * Report schema version. Schema v2 (2.0.0) restructures CPU data under
 * `report.profiles.cpu.*` and introduces `profileKinds` in meta; prior v1
 * kept CPU sections at the root.
 */
export const LANTERNA_REPORT_SCHEMA_VERSION = '2.0.0';

/**
 * Builds {@link ReportMeta} by iterating the kinds and asking each for its
 * meta + integrity contributions. The builder itself is kind-blind.
 */
export function buildReportMeta(
  bundle: CaptureBundle,
  kinds: ReadonlyArray<ProfileKind>,
  opts: AnalysisOptions,
): ReportMeta {
  const kindsMeta: Record<string, unknown> = {};
  const kindsIntegrity: Record<string, unknown> = { ...bundle.captureIntegrity.kinds };
  const capturedKinds: string[] = [];
  for (const kind of kinds) {
    const data = bundle.kinds[kind.id];
    if (data === undefined) continue;
    capturedKinds.push(kind.id);
    if (kind.contributeMeta) {
      kindsMeta[kind.id] = kind.contributeMeta(data);
    }
    if (kind.contributeIntegrity) {
      kindsIntegrity[kind.id] = kind.contributeIntegrity(data);
    }
  }

  return {
    schemaVersion: LANTERNA_REPORT_SCHEMA_VERSION,
    nodeVersion: bundle.target.nodeVersion,
    v8Version: bundle.target.v8Version,
    platform: bundle.target.platform,
    arch: bundle.target.arch,
    pid: bundle.target.pid,
    startedAt: new Date(bundle.startedAtEpoch).toISOString(),
    durationMs: bundle.durationMs,
    cwd: bundle.target.cwd,
    command: opts.command,
    lanternaVersion: LANTERNA_VERSION,
    mode: opts.mode ?? 'spawn',
    profileKinds: capturedKinds,
    kinds: kindsMeta,
    captureIntegrity: {
      ...bundle.captureIntegrity,
      kinds: kindsIntegrity,
    },
  };
}
