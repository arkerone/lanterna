import type { Finding, Hotspot } from '@lanterna-profiler/core';

const SPECIFIC_CPU_FINDING_CATEGORIES = new Set([
  'blocking-io',
  'sync-crypto',
  'json-on-hot-path',
  'node-modules-hotspot',
  'require-in-hot-path',
]);

export function isHotspotExplainedByFindings(
  hotspot: Hotspot,
  findings: readonly Finding[],
): boolean {
  return findings.some((finding) => isHotspotExplainedByFinding(hotspot, finding));
}

export function isHotspotExplainedByFinding(hotspot: Hotspot, finding: Finding): boolean {
  if (!SPECIFIC_CPU_FINDING_CATEGORIES.has(finding.category)) return false;
  if (sameFrameLocation(finding.evidence, hotspot)) return true;
  if (sameSourceMappedFrame(finding.evidence.source, hotspot)) return true;
  const extra = finding.evidence.extra as
    | { userCaller?: unknown; candidateCallers?: unknown }
    | undefined;
  if (sameUnknownFindingFrame(extra?.userCaller, hotspot)) return true;
  if (!Array.isArray(extra?.candidateCallers)) return false;
  return extra.candidateCallers.some((candidate) => sameUnknownFindingFrame(candidate, hotspot));
}

function sameUnknownFindingFrame(candidate: unknown, hotspot: Hotspot): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  return sameFrameLocation(
    candidate as { file?: string; line?: number; function?: string },
    hotspot,
  );
}

function sameFrameLocation(
  candidate: { file?: string; line?: number; function?: string },
  hotspot: Hotspot,
): boolean {
  return (
    candidate.file === hotspot.file &&
    candidate.line === hotspot.line &&
    candidate.function === hotspot.function
  );
}

function sameSourceMappedFrame(
  source: { file?: string; line?: number; name?: string } | undefined,
  hotspot: Hotspot,
): boolean {
  if (!source || !hotspot.source) return false;
  return (
    source.file === hotspot.source.file &&
    source.line === hotspot.source.line &&
    (source.name === undefined ||
      hotspot.source.name === undefined ||
      source.name === hotspot.source.name)
  );
}
