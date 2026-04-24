import type { RawCpuProfile, RawGcEvent } from '../../capture/core/types.js';
import type { CorrelatedHotspot, CorrelationCoverage, FrameCategory } from '../../report/types.js';
import { GC_CORRELATION_LOOKAROUND_MS } from '../../shared/config.js';
import type { EnrichedTree, NodeEnriched } from './hotspots.js';

export interface TimedSample {
  atMs: number;
  leafId: number;
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export interface CorrelationResult {
  hotspots: CorrelatedHotspot[];
  coverage: CorrelationCoverage;
}

export function buildTimedSamples(
  cpuProfile: RawCpuProfile,
  sampleIntervalMicros: number,
): TimedSample[] {
  const sampleLeafIds = cpuProfile.samples ?? [];
  if (sampleLeafIds.length === 0) return [];

  const sampleTimeDeltas = cpuProfile.timeDeltas ?? [];
  const fallbackDeltaUs = sampleIntervalMicros;
  let elapsedUs = 0;
  const timedSamples: TimedSample[] = [];

  for (let sampleIndex = 0; sampleIndex < sampleLeafIds.length; sampleIndex++) {
    elapsedUs += sampleTimeDeltas[sampleIndex] ?? fallbackDeltaUs;
    const leafId = sampleLeafIds[sampleIndex];
    if (leafId === undefined) continue;
    timedSamples.push({
      atMs: elapsedUs / 1000,
      leafId,
    });
  }

  return timedSamples;
}

export function correlateUserHotspots(
  timedSamples: TimedSample[],
  tree: EnrichedTree,
  windows: TimeWindow[],
  options: { topN?: number } = {},
): CorrelatedHotspot[] {
  return correlateUserHotspotsWithCoverage(timedSamples, tree, windows, options).hotspots;
}

export function correlateUserHotspotsWithCoverage(
  timedSamples: TimedSample[],
  tree: EnrichedTree,
  windows: TimeWindow[],
  options: { topN?: number } = {},
): CorrelationResult {
  const emptyCoverage: CorrelationCoverage = {
    samplesInWindows: 0,
    samplesAttributed: 0,
    windowCount: windows.length,
    attributionRate: 0,
  };
  if (timedSamples.length === 0 || windows.length === 0) {
    return { hotspots: [], coverage: emptyCoverage };
  }

  const overlapCountsByNodeKey = new Map<string, { count: number; node: NodeEnriched }>();
  let samplesInWindows = 0;
  let samplesAttributed = 0;

  for (const sample of timedSamples) {
    if (!isInAnyWindow(sample.atMs, windows)) continue;
    samplesInWindows += 1;
    const node = firstAncestorByCategory(sample.leafId, tree, 'user');
    if (!node) continue;
    samplesAttributed += 1;
    const nodeKey = makeNodeKey(node);
    const existing = overlapCountsByNodeKey.get(nodeKey);
    if (existing) {
      existing.count += 1;
    } else {
      overlapCountsByNodeKey.set(nodeKey, { count: 1, node });
    }
  }

  const coverage: CorrelationCoverage = {
    samplesInWindows,
    samplesAttributed,
    windowCount: windows.length,
    attributionRate: samplesInWindows === 0 ? 0 : samplesAttributed / samplesInWindows,
  };

  if (samplesAttributed === 0) return { hotspots: [], coverage };

  const totalSamples = Math.max(1, timedSamples.length);
  const sorted = Array.from(overlapCountsByNodeKey.values()).sort((a, b) => b.count - a.count);
  const topN = options.topN ?? 3;
  const limited = sorted.slice(0, topN);

  const hotspots: CorrelatedHotspot[] = limited.map(({ count, node }, index) => {
    const overlapPct = (count / samplesAttributed) * 100;
    const next = limited[index + 1];
    const nextOverlapPct = next ? (next.count / samplesAttributed) * 100 : 0;
    return {
      id: `${node.file}:${node.line}:${node.function}`,
      function: node.function,
      file: node.file,
      line: node.line,
      overlapPct,
      samplePct: (count / totalSamples) * 100,
      rank: index + 1,
      confidence: scoreConfidence(overlapPct, nextOverlapPct),
    };
  });

  return { hotspots, coverage };
}

export function scoreConfidence(
  overlapPct: number,
  nextOverlapPct: number,
): 'low' | 'medium' | 'high' {
  if (overlapPct >= 60) return 'high';
  if (overlapPct >= 30 && overlapPct - nextOverlapPct >= 15) return 'high';
  if (overlapPct >= 25) return 'medium';
  return 'low';
}

export function buildGcCorrelationWindows(
  gcEvents: RawGcEvent[],
  durationMs: number,
  lookaroundMs = GC_CORRELATION_LOOKAROUND_MS,
): TimeWindow[] {
  return gcEvents.map((event) => ({
    startMs: Math.max(0, event.atMs - lookaroundMs),
    endMs: Math.min(durationMs, event.atMs + event.durationMs + lookaroundMs),
  }));
}

function firstAncestorByCategory(
  leafId: number,
  tree: EnrichedTree,
  category: FrameCategory,
): NodeEnriched | undefined {
  let currentNodeId: number | undefined = leafId;
  const visitedNodeIds = new Set<number>();
  while (currentNodeId !== undefined && !visitedNodeIds.has(currentNodeId)) {
    visitedNodeIds.add(currentNodeId);
    const node = tree.nodes.get(currentNodeId);
    if (!node) return undefined;
    if (node.category === category) return node;
    currentNodeId = tree.parentOf.get(currentNodeId);
  }
  return undefined;
}

function isInAnyWindow(atMs: number, windows: TimeWindow[]): boolean {
  return windows.some((window) => atMs >= window.startMs && atMs <= window.endMs);
}

function makeNodeKey(node: NodeEnriched): string {
  return `${node.file}|${node.function}|${node.line}`;
}
