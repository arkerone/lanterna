import type { RawCapture } from '../collector/source.js';
import type { CorrelatedHotspot, FrameCategory } from '../report/types.js';
import type { EnrichedTree, NodeEnriched } from './hotspots.js';

export interface TimedSample {
  atMs: number;
  leafId: number;
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export function buildTimedSamples(
  raw: RawCapture,
  sampleIntervalMicros: number,
): TimedSample[] {
  const samples = raw.cpuProfile.samples ?? [];
  if (samples.length === 0) return [];

  const deltas = raw.cpuProfile.timeDeltas ?? [];
  const fallbackDeltaUs = sampleIntervalMicros;
  let elapsedUs = 0;
  const timed: TimedSample[] = [];

  for (let i = 0; i < samples.length; i++) {
    elapsedUs += deltas[i] ?? fallbackDeltaUs;
    const leafId = samples[i];
    if (leafId === undefined) continue;
    timed.push({
      atMs: elapsedUs / 1000,
      leafId,
    });
  }

  return timed;
}

export function correlateUserHotspots(
  timedSamples: TimedSample[],
  tree: EnrichedTree,
  windows: TimeWindow[],
  opts: { topN?: number } = {},
): CorrelatedHotspot[] {
  if (timedSamples.length === 0 || windows.length === 0) return [];

  const counts = new Map<string, { count: number; node: NodeEnriched }>();
  let overlapSamples = 0;

  for (const sample of timedSamples) {
    if (!isInAnyWindow(sample.atMs, windows)) continue;
    const node = firstAncestorByCategory(sample.leafId, tree, 'user');
    if (!node) continue;
    overlapSamples += 1;
    const key = makeNodeKey(node);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { count: 1, node });
    }
  }

  if (overlapSamples === 0) return [];

  const totalSamples = Math.max(1, timedSamples.length);
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, opts.topN ?? 3)
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
  lookaroundMs = 20,
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
  let current: number | undefined = leafId;
  const seen = new Set<number>();
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const node = tree.nodes.get(current);
    if (!node) return undefined;
    if (node.category === category) return node;
    current = tree.parentOf.get(current);
  }
  return undefined;
}

function isInAnyWindow(atMs: number, windows: TimeWindow[]): boolean {
  return windows.some((window) => atMs >= window.startMs && atMs <= window.endMs);
}

function makeNodeKey(node: NodeEnriched): string {
  return `${node.file}|${node.function}|${node.line}`;
}
