import type {
  AlternativeHotspotEvidence,
  BuiltinFinding,
  CpuHotspotEvidenceExtra,
  Finding,
  Hotspot,
  KindScopedDetector,
  LanternaReport,
  StallCorrelation,
} from '@lanterna-profiler/core';
import { defineBuiltinFinding } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';

const SPECIFIC_CPU_FINDING_CATEGORIES = new Set([
  'blocking-io',
  'sync-crypto',
  'json-on-hot-path',
  'node-modules-hotspot',
  'require-in-hot-path',
]);

type CpuHotspotMode = CpuHotspotEvidenceExtra['mode'];

/**
 * Generic fallback for user-code CPU bottlenecks. Pattern detectors explain
 * known anti-patterns; this explains "plain code is just hot" and gives agents
 * a concrete file/line or caller lead even when no specialized category applies.
 */
export const cpuHotspotDetector: KindScopedDetector<'cpu'> = {
  id: 'cpu-hotspot',
  kindIds: ['cpu'],
  order: 90,
  detect({ cpu }, shared): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.cpuHotspot;
    const candidates = cpu.report.hotspots
      .filter((hotspot) => hotspot.category === 'user')
      .filter(
        (hotspot) =>
          hotspot.selfPct >= thresholds.minSelfPct || hotspot.totalPct >= thresholds.minTotalPct,
      )
      .filter(
        (hotspot) =>
          !(
            hasSpecificCpuFindings(shared.findings) &&
            isAnonymousWrapper(hotspot) &&
            hotspot.selfPct < thresholds.minSelfPct
          ),
      )
      .filter((hotspot) => !isExplainedBySpecificFinding(hotspot, shared.findings))
      .sort(compareHotspots);
    const selfHotspots = candidates.filter((hotspot) => hotspot.selfPct >= thresholds.minSelfPct);
    const mode: CpuHotspotMode = selfHotspots.length > 0 ? 'self' : 'inclusive-entry';
    const explanationPool = selfHotspots.length > 0 ? selfHotspots : candidates;
    const namedPool = explanationPool.some((hotspot) => !isAnonymousWrapper(hotspot))
      ? explanationPool.filter((hotspot) => !isAnonymousWrapper(hotspot))
      : explanationPool;

    return namedPool.slice(0, thresholds.maxFindings).map((hotspot, index) =>
      buildFinding(
        hotspot,
        candidates.filter((candidate) => candidate.id !== hotspot.id).slice(0, 2),
        cpu.report.eventLoop.correlatedHotspots?.find((candidate) => sameFrame(candidate, hotspot)),
        mode,
        index,
      ),
    );
  },
};

function compareHotspots(left: Hotspot, right: Hotspot): number {
  const selfDelta = right.selfPct - left.selfPct;
  if (selfDelta !== 0) return selfDelta;
  return right.totalPct - left.totalPct;
}

function isAnonymousWrapper(hotspot: Hotspot): boolean {
  return hotspot.function === '(anonymous)' || hotspot.function.trim() === '';
}

function hasSpecificCpuFindings(findings: readonly LanternaReport['findings'][number][]): boolean {
  return findings.some((finding) => SPECIFIC_CPU_FINDING_CATEGORIES.has(finding.category));
}

function buildFinding(
  hotspot: Hotspot,
  alternatives: Hotspot[],
  eventLoopCorrelation: StallCorrelation | undefined,
  mode: CpuHotspotMode,
  index: number,
): BuiltinFinding<'cpu-hotspot'> {
  const thresholds = DETECTOR_THRESHOLDS.cpuHotspot;
  const score = Math.max(hotspot.selfPct, hotspot.totalPct);
  const severity: BuiltinFinding<'cpu-hotspot'>['severity'] =
    score >= thresholds.criticalPct ? 'critical' : 'warning';
  const evidenceExtra: CpuHotspotEvidenceExtra = {
    proofLevel: mode === 'self' ? 'direct-user-hotspot' : 'inclusive-user-entry',
    mode,
    category: hotspot.category,
    selfPct: hotspot.selfPct,
    totalPct: hotspot.totalPct,
    ...(eventLoopCorrelation
      ? {
          eventLoopCorrelation: {
            overlapPct: eventLoopCorrelation.overlapPct,
            samplePct: eventLoopCorrelation.samplePct,
          },
        }
      : {}),
    alternativeHotspots: alternatives.map(toAlternativeHotspotEvidence),
  };

  return defineBuiltinFinding({
    id: `cpu-hotspot:${hotspot.id}`,
    profileKind: 'cpu',
    severity,
    category: 'cpu-hotspot',
    title:
      mode === 'self'
        ? `${hotspot.function} is a CPU hotspot`
        : `${hotspot.function} leads to unexplained CPU work`,
    confidence: mode === 'self' ? (index === 0 ? 'high' : 'medium') : 'medium',
    proofLevel: mode === 'self' ? 'direct-sample' : 'heuristic',
    evidence: {
      file: hotspot.source?.file ?? hotspot.file,
      line: hotspot.source?.line ?? hotspot.line,
      function: hotspot.source?.name ?? hotspot.function,
      selfPct: hotspot.selfPct,
      ...(hotspot.source ? { source: hotspot.source } : {}),
      extra: evidenceExtra,
    },
    measurements: {
      observed: {
        selfPct: hotspot.selfPct,
        totalPct: hotspot.totalPct,
      },
      thresholds: {
        minSelfPct: thresholds.minSelfPct,
        minTotalPct: thresholds.minTotalPct,
        criticalPct: thresholds.criticalPct,
      },
    },
    remediation: {
      kind: mode === 'self' ? 'offload-worker' : 'other',
      notes:
        mode === 'self'
          ? 'This is not a known blocking API pattern; inspect the sampled function body directly. Reduce algorithmic cost, cache stable results, or move CPU-bound work to worker_threads/piscina.'
          : 'This user frame is inclusive-heavy but not self-heavy. Inspect the callees and hot stacks first; the caller may only be the entry point to missing detector coverage or external CPU work.',
    },
    why:
      mode === 'self'
        ? `\`${hotspot.function}\` accounts for ${hotspot.selfPct.toFixed(1)}% self CPU and ${hotspot.totalPct.toFixed(1)}% inclusive CPU. No more specific built-in detector explained this frame, so the function body itself is the bottleneck.`
        : `\`${hotspot.function}\` accounts for only ${hotspot.selfPct.toFixed(1)}% self CPU but ${hotspot.totalPct.toFixed(1)}% inclusive CPU. No more specific built-in detector explained the downstream work, so this is a caller/context lead rather than proof that the function body is expensive.`,
    suggestion:
      mode === 'self'
        ? 'Open this function first. Look for tight loops, repeated transformations, excessive object work, or synchronous CPU-heavy algorithms. If the work is inherently expensive, move it off the main event loop.'
        : 'Open this caller and inspect the top callees/hot stacks. If the downstream work is a known API pattern, add or tune a specialized detector; otherwise reduce call frequency, input size, or move the downstream CPU off the main event loop.',
    references: [
      'https://nodejs.org/en/docs/guides/dont-block-the-event-loop',
      'https://nodejs.org/api/worker_threads.html',
    ],
  });
}

function toAlternativeHotspotEvidence(hotspot: Hotspot): AlternativeHotspotEvidence {
  return {
    id: hotspot.id,
    function: hotspot.function,
    file: hotspot.source?.file ?? hotspot.file,
    line: hotspot.source?.line ?? hotspot.line,
    selfPct: hotspot.selfPct,
    totalPct: hotspot.totalPct,
    ...(hotspot.source ? { source: hotspot.source } : {}),
  };
}

function isExplainedBySpecificFinding(
  hotspot: Hotspot,
  findings: readonly LanternaReport['findings'][number][],
): boolean {
  return findings.some((finding) => {
    if (!SPECIFIC_CPU_FINDING_CATEGORIES.has(finding.category)) return false;
    if (sameFrame(finding.evidence, hotspot)) return true;
    if (sameSourceFrame(finding.evidence.source, hotspot)) return true;
    const extra = finding.evidence.extra as
      | { userCaller?: unknown; candidateCallers?: unknown }
      | undefined;
    if (sameUnknownFrame(extra?.userCaller, hotspot)) return true;
    if (!Array.isArray(extra?.candidateCallers)) return false;
    return extra.candidateCallers.some((candidate) => sameUnknownFrame(candidate, hotspot));
  });
}

function sameUnknownFrame(candidate: unknown, hotspot: Hotspot): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  return sameFrame(candidate as { file?: string; line?: number; function?: string }, hotspot);
}

function sameFrame(
  candidate: { file?: string; line?: number; function?: string },
  hotspot: Hotspot,
): boolean {
  return (
    candidate.file === hotspot.file &&
    candidate.line === hotspot.line &&
    candidate.function === hotspot.function
  );
}

function sameSourceFrame(
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
