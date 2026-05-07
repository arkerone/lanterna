import { describe, expect, it } from 'vitest';
import {
  buildGcCorrelationWindows,
  buildTimedSamples,
  type CorrelationResult,
  correlateUserHotspots,
  correlateUserHotspotsWithCoverage,
  scoreConfidence,
  type TimedSample,
  type TimeWindow,
} from '../src/analysis/model/correlations.js';
import type { EnrichedTree, NodeEnriched } from '../src/analysis/model/hotspots.js';
import type { RawCpuProfile, RawGcEvent } from '../src/capture/core/types.js';
import type { FrameCategory } from '../src/report/types.js';

interface NodeOptions {
  id: number;
  function?: string;
  file?: string;
  line?: number;
  category?: FrameCategory;
  parentId?: number;
}

function makeTree(nodes: NodeOptions[], rootId = 0): EnrichedTree {
  const nodeMap = new Map<number, NodeEnriched>();
  const parentOf = new Map<number, number>();
  for (const opt of nodes) {
    nodeMap.set(opt.id, {
      id: opt.id,
      function: opt.function ?? `fn${opt.id}`,
      file: opt.file ?? `src/file${opt.id}.ts`,
      line: opt.line ?? opt.id,
      column: 1,
      category: opt.category ?? 'user',
      hitCount: 0,
      children: [],
      optimizationState: 'unknown',
    });
    if (opt.parentId !== undefined) parentOf.set(opt.id, opt.parentId);
  }
  return {
    nodes: nodeMap,
    rootId,
    parentOf,
    totalSamples: 0,
    totalMs: 0,
    sampleIntervalMs: 1,
  };
}

describe('buildTimedSamples', () => {
  it('returns an empty array when there are no samples', () => {
    const profile = { samples: [], timeDeltas: [], nodes: [] } as unknown as RawCpuProfile;
    expect(buildTimedSamples(profile, 1000)).toEqual([]);
  });

  it('uses the provided time deltas to compute atMs in milliseconds', () => {
    const profile = {
      samples: [10, 20, 30],
      timeDeltas: [1000, 2000, 3000], // microseconds
      nodes: [],
    } as unknown as RawCpuProfile;
    const result = buildTimedSamples(profile, 999);
    expect(result).toEqual([
      { atMs: 1, leafId: 10 },
      { atMs: 3, leafId: 20 },
      { atMs: 6, leafId: 30 },
    ]);
  });

  it('falls back to sampleIntervalMicros when timeDeltas are missing for a sample', () => {
    const profile = {
      samples: [1, 2, 3],
      timeDeltas: [500], // shorter than samples
      nodes: [],
    } as unknown as RawCpuProfile;
    const result = buildTimedSamples(profile, 1000);
    expect(result).toEqual([
      { atMs: 0.5, leafId: 1 },
      { atMs: 1.5, leafId: 2 },
      { atMs: 2.5, leafId: 3 },
    ]);
  });

  it('skips samples with undefined leaf ids without breaking time accumulation', () => {
    const profile = {
      samples: [1, undefined, 3],
      timeDeltas: [1000, 1000, 1000],
      nodes: [],
    } as unknown as RawCpuProfile;
    const result = buildTimedSamples(profile, 1000);
    expect(result).toEqual([
      { atMs: 1, leafId: 1 },
      { atMs: 3, leafId: 3 },
    ]);
  });
});

describe('scoreConfidence', () => {
  it.each([
    [80, 0, 'high'],
    [60, 30, 'high'], // exactly 60 → high
    [40, 20, 'high'], // 40 - 20 = 20 >= 15
    [40, 30, 'medium'], // 40 - 30 = 10 < 15
    [25, 0, 'medium'],
    [24, 0, 'low'],
    [10, 0, 'low'],
  ] as const)('returns %s/%s -> %s', (overlap, next, expected) => {
    expect(scoreConfidence(overlap, next)).toBe(expected);
  });
});

describe('buildGcCorrelationWindows', () => {
  it('returns an empty array when there are no GC events', () => {
    expect(buildGcCorrelationWindows([], 5000)).toEqual([]);
  });

  it('expands each event by the lookaround on both sides and clamps to [0, durationMs]', () => {
    const events: RawGcEvent[] = [
      { atMs: 100, durationMs: 50, kind: 'minor' },
      { atMs: 4990, durationMs: 5, kind: 'major' },
    ];
    const windows = buildGcCorrelationWindows(events, 5000, 100);
    expect(windows).toEqual([
      { startMs: 0, endMs: 250 }, // 100 - 100 clamped to 0; 100 + 50 + 100 = 250
      { startMs: 4890, endMs: 5000 }, // 4990 - 100 = 4890; 4990 + 5 + 100 = 5095 clamped to 5000
    ]);
  });

  it('applies the default lookaround when not specified', () => {
    const events: RawGcEvent[] = [{ atMs: 1000, durationMs: 0, kind: 'minor' }];
    const [window] = buildGcCorrelationWindows(events, 5000);
    expect(window).toBeDefined();
    expect(window?.startMs).toBeGreaterThanOrEqual(0);
    expect(window?.endMs).toBeGreaterThan(window?.startMs ?? 0);
  });
});

describe('correlateUserHotspotsWithCoverage', () => {
  function asResult(r: CorrelationResult): CorrelationResult {
    return r;
  }

  it('returns an empty result when there are no samples', () => {
    const tree = makeTree([{ id: 0 }]);
    const result = correlateUserHotspotsWithCoverage([], tree, [{ startMs: 0, endMs: 100 }]);
    expect(result.hotspots).toEqual([]);
    expect(result.coverage).toEqual({
      samplesInWindows: 0,
      samplesAttributed: 0,
      windowCount: 1,
      attributionRate: 0,
    });
  });

  it('returns an empty result when there are no windows', () => {
    const tree = makeTree([{ id: 0 }]);
    const samples: TimedSample[] = [{ atMs: 50, leafId: 0 }];
    const result = correlateUserHotspotsWithCoverage(samples, tree, []);
    expect(result.hotspots).toEqual([]);
    expect(result.coverage.windowCount).toBe(0);
  });

  it('attributes leaf samples to their first user ancestor and aggregates by node key', () => {
    // Tree: 0 (root) -> 1 (user "calc") -> 2 (native), 3 (user "calc" same fn) — leaves 2 and 3
    const tree = makeTree([
      { id: 0, category: 'native' },
      {
        id: 1,
        function: 'calc',
        file: 'src/math.ts',
        line: 10,
        category: 'user',
        parentId: 0,
      },
      { id: 2, category: 'native', parentId: 1 },
      {
        id: 3,
        function: 'calc',
        file: 'src/math.ts',
        line: 10,
        category: 'user',
        parentId: 0,
      },
    ]);
    const samples: TimedSample[] = [
      { atMs: 10, leafId: 2 }, // climbs to id=1 (calc)
      { atMs: 20, leafId: 2 },
      { atMs: 30, leafId: 3 }, // already a user leaf same fn — same key
    ];
    const windows: TimeWindow[] = [{ startMs: 0, endMs: 100 }];
    const result = asResult(correlateUserHotspotsWithCoverage(samples, tree, windows));
    expect(result.coverage.samplesInWindows).toBe(3);
    expect(result.coverage.samplesAttributed).toBe(3);
    expect(result.coverage.attributionRate).toBe(1);
    expect(result.hotspots).toHaveLength(1);
    const top = result.hotspots[0];
    expect(top?.function).toBe('calc');
    expect(top?.rank).toBe(1);
    expect(top?.overlapPct).toBe(100);
    expect(top?.samplePct).toBe(100);
  });

  it('only counts samples that fall inside at least one window', () => {
    const tree = makeTree([
      { id: 0, category: 'native' },
      { id: 1, category: 'user', parentId: 0, function: 'inWindow' },
      { id: 2, category: 'user', parentId: 0, function: 'outWindow' },
    ]);
    const samples: TimedSample[] = [
      { atMs: 50, leafId: 1 }, // in window
      { atMs: 500, leafId: 2 }, // out of window
    ];
    const windows: TimeWindow[] = [{ startMs: 0, endMs: 100 }];
    const result = correlateUserHotspotsWithCoverage(samples, tree, windows);
    expect(result.coverage.samplesInWindows).toBe(1);
    expect(result.coverage.samplesAttributed).toBe(1);
    expect(result.hotspots).toHaveLength(1);
    expect(result.hotspots[0]?.function).toBe('inWindow');
    // samplePct uses totalSamples (2), overlapPct uses samplesAttributed (1)
    expect(result.hotspots[0]?.overlapPct).toBe(100);
    expect(result.hotspots[0]?.samplePct).toBe(50);
  });

  it('skips samples whose leaf has no user ancestor', () => {
    const tree = makeTree([
      { id: 0, category: 'native' },
      { id: 1, category: 'native', parentId: 0 },
    ]);
    const samples: TimedSample[] = [{ atMs: 10, leafId: 1 }];
    const windows: TimeWindow[] = [{ startMs: 0, endMs: 100 }];
    const result = correlateUserHotspotsWithCoverage(samples, tree, windows);
    expect(result.coverage.samplesInWindows).toBe(1);
    expect(result.coverage.samplesAttributed).toBe(0);
    expect(result.hotspots).toEqual([]);
  });

  it('respects the topN option (default 3) and ranks hotspots in descending order', () => {
    // Three user leaves with different sample counts
    const nodeIds = [10, 20, 30, 40];
    const tree = makeTree([
      { id: 0, category: 'native' },
      ...nodeIds.map((id) => ({
        id,
        category: 'user' as FrameCategory,
        parentId: 0,
        function: `fn${id}`,
        file: `src/${id}.ts`,
        line: id,
      })),
    ]);
    // counts: fn40 x4, fn30 x3, fn20 x2, fn10 x1
    const samples: TimedSample[] = [
      ...Array.from({ length: 4 }, (_, i) => ({ atMs: i, leafId: 40 })),
      ...Array.from({ length: 3 }, (_, i) => ({ atMs: i + 10, leafId: 30 })),
      ...Array.from({ length: 2 }, (_, i) => ({ atMs: i + 20, leafId: 20 })),
      { atMs: 30, leafId: 10 },
    ];
    const windows: TimeWindow[] = [{ startMs: 0, endMs: 1000 }];
    const top2 = correlateUserHotspotsWithCoverage(samples, tree, windows, { topN: 2 });
    expect(top2.hotspots.map((h) => h.function)).toEqual(['fn40', 'fn30']);
    const defaultTop = correlateUserHotspotsWithCoverage(samples, tree, windows);
    expect(defaultTop.hotspots).toHaveLength(3); // default topN = 3
    expect(defaultTop.hotspots.map((h) => h.function)).toEqual(['fn40', 'fn30', 'fn20']);
  });

  it('forwards the source location when present on the user ancestor', () => {
    const tree = makeTree([
      { id: 0, category: 'native' },
      { id: 1, category: 'user', parentId: 0, function: 'calc' },
    ]);
    const userNode = tree.nodes.get(1);
    if (!userNode) throw new Error('expected user node');
    userNode.source = {
      file: 'src/math.original.ts',
      line: 42,
      column: 5,
    };
    const samples: TimedSample[] = [{ atMs: 5, leafId: 1 }];
    const result = correlateUserHotspotsWithCoverage(samples, tree, [{ startMs: 0, endMs: 100 }]);
    expect(result.hotspots[0]?.source).toEqual({
      file: 'src/math.original.ts',
      line: 42,
      column: 5,
    });
  });

  it('correlateUserHotspots returns just the hotspots array (matches the wrapped overload)', () => {
    const tree = makeTree([
      { id: 0, category: 'native' },
      { id: 1, category: 'user', parentId: 0, function: 'fn' },
    ]);
    const samples: TimedSample[] = [{ atMs: 5, leafId: 1 }];
    const hotspots = correlateUserHotspots(samples, tree, [{ startMs: 0, endMs: 100 }]);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]?.function).toBe('fn');
  });
});
