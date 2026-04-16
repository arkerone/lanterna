import type {
  AttributionEvidence,
  AlternativeHotspotEvidence,
  BaseFinding,
  BlockingIoEvidenceExtra,
  BuiltinFindingCategory,
  JsonHotPathEvidenceExtra,
  NodeModulesHotspotEvidenceExtra,
  Hotspot,
  LanternaReport,
  RequireInHotPathEvidenceExtra,
  StallCorrelation,
  SyncCryptoEvidenceExtra,
} from '@lanterna/core';
import type { HotspotAttribution } from '@lanterna/core';
import type { FindingContext } from './types.js';

export interface ResolvedAttribution {
  attribution: HotspotAttribution | undefined;
  caller: HotspotAttribution | undefined;
}

export function resolveAttribution(
  hotspot: Hotspot,
  context: FindingContext,
): ResolvedAttribution {
  const attribution = context.userAttributionById.get(hotspot.id);
  const caller = attribution?.confidence === 'high' ? attribution : undefined;
  return { attribution, caller };
}

export function findStallCorrelation(
  caller: { file: string; line: number; function: string } | undefined,
  report: LanternaReport,
): StallCorrelation | undefined {
  if (!caller) return undefined;
  const match = report.eventLoop.correlatedHotspots?.find((candidate) =>
    candidate.file === caller.file
    && candidate.line === caller.line
    && candidate.function === caller.function,
  );
  if (!match) return undefined;
  return { overlapPct: match.overlapPct, samplePct: match.samplePct };
}

export function buildAttributionEvidence(
  attribution: HotspotAttribution | undefined,
  caller: HotspotAttribution | undefined,
): AttributionEvidence {
  return {
    proofLevel: caller ? 'attributed-caller' : 'direct-builtin',
    attributionBasis: caller ? 'sample-path' : 'builtin-only',
    attributionConfidence: caller?.confidence ?? 'low',
    userAttribution: attribution,
  };
}

export function toAlternativeHotspotEvidence(
  hotspot: Hotspot,
): AlternativeHotspotEvidence {
  return {
    id: hotspot.id,
    function: hotspot.function,
    file: hotspot.file,
    line: hotspot.line,
    selfPct: hotspot.selfPct,
    totalPct: hotspot.totalPct,
  };
}

export function resolveEvidenceField<K extends 'file' | 'line' | 'function'>(
  caller: HotspotAttribution | undefined,
  hotspot: Hotspot,
  field: K,
): Hotspot[K] {
  return (caller?.[field] ?? hotspot[field]) as Hotspot[K];
}

type AttributedFindingExtra =
  | BlockingIoEvidenceExtra
  | SyncCryptoEvidenceExtra
  | JsonHotPathEvidenceExtra
  | NodeModulesHotspotEvidenceExtra
  | RequireInHotPathEvidenceExtra;

export function buildAttributedFinding<
  C extends Extract<
    BuiltinFindingCategory,
    'blocking-io' | 'sync-crypto' | 'json-on-hot-path' | 'node-modules-hotspot' | 'require-in-hot-path'
  >,
>(
  options: {
    id: string;
    category: C;
    severity: BaseFinding['severity'];
    title: string;
    hotspot: Hotspot;
    caller: HotspotAttribution | undefined;
    selfPct: number;
    why: string;
    suggestion: string;
    references: string[];
    extra: AttributedFindingExtra;
  },
): BaseFinding<
  C,
  C extends 'blocking-io'
    ? BlockingIoEvidenceExtra
    : C extends 'sync-crypto'
      ? SyncCryptoEvidenceExtra
      : C extends 'json-on-hot-path'
        ? JsonHotPathEvidenceExtra
        : C extends 'node-modules-hotspot'
          ? NodeModulesHotspotEvidenceExtra
          : RequireInHotPathEvidenceExtra
> {
  const {
    id,
    category,
    severity,
    title,
    hotspot,
    caller,
    selfPct,
    why,
    suggestion,
    references,
    extra,
  } = options;

  return {
    id,
    severity,
    category,
    title,
    evidence: {
      file: resolveEvidenceField(caller, hotspot, 'file'),
      line: resolveEvidenceField(caller, hotspot, 'line'),
      function: resolveEvidenceField(caller, hotspot, 'function'),
      selfPct,
      extra: extra as
        C extends 'blocking-io'
          ? BlockingIoEvidenceExtra
          : C extends 'sync-crypto'
            ? SyncCryptoEvidenceExtra
            : C extends 'json-on-hot-path'
              ? JsonHotPathEvidenceExtra
              : C extends 'node-modules-hotspot'
                ? NodeModulesHotspotEvidenceExtra
                : RequireInHotPathEvidenceExtra,
    },
    why,
    suggestion,
    references,
  };
}
