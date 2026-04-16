import type { RawCapture } from '../../capture/core/types.js';
import type { CorrelatedHotspot, FrameCategory } from '../../report/types.js';
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

export function buildTimedSamples(raw: RawCapture, sampleIntervalMicros: number): TimedSample[] {
  const sampleLeafIds = raw.cpuProfile.samples ?? [];
  if (sampleLeafIds.length === 0) return [];

  const sampleTimeDeltas = raw.cpuProfile.timeDeltas ?? [];
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
  if (timedSamples.length === 0 || windows.length === 0) return [];

  const overlapCountsByNodeKey = new Map<string, { count: number; node: NodeEnriched }>();
  let overlapSamples = 0;

  for (const sample of timedSamples) {
    if (!isInAnyWindow(sample.atMs, windows)) continue;
    const node = firstAncestorByCategory(sample.leafId, tree, 'user');
    if (!node) continue;
    overlapSamples += 1;
    const nodeKey = makeNodeKey(node);
    const existing = overlapCountsByNodeKey.get(nodeKey);
    if (existing) {
      existing.count += 1;
    } else {
      overlapCountsByNodeKey.set(nodeKey, { count: 1, node });
    }
  }

  if (overlapSamples === 0) return [];

  const totalSamples = Math.max(1, timedSamples.length);
  return Array.from(overlapCountsByNodeKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, options.topN ?? 3)
    .map(({ count, node }) => ({
      id: `${node.file}:${node.line}:${node.function}`,
      function: node.function,
      file: node.file,
      line: node.line,
      overlapPct: (count / overlapSamples) * 100,
      samplePct: (count / totalSamples) * 100,
    }));
}

export function buildGcCorrelationWindows(
  raw: RawCapture,
  lookaroundMs = GC_CORRELATION_LOOKAROUND_MS,
): TimeWindow[] {
  return raw.gcEvents.map((event) => ({
    startMs: Math.max(0, event.atMs - lookaroundMs),
    endMs: Math.min(raw.durationMs, event.atMs + event.durationMs + lookaroundMs),
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
