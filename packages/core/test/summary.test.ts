import { describe, expect, it } from 'vitest';
import type { EnrichedTree, NodeEnriched } from '../src/analysis/model/hotspots.js';
import {
  buildCpuSummary,
  deriveDominantBlockingKind,
  deriveTopCpuCulprit,
  deriveTopUserHotspot,
} from '../src/analysis/model/summary.js';
import type {
  CorrelatedHotspot,
  FrameCategory,
  Hotspot,
  LanternaReport,
} from '../src/report/types.js';

interface NodeOptions {
  id: number;
  category: FrameCategory;
  hitCount?: number;
  function?: string;
}

function makeTree(opts: NodeOptions[], sampleIntervalMs = 1): EnrichedTree {
  const nodes = new Map<number, NodeEnriched>();
  let totalSamples = 0;
  for (const o of opts) {
    const hit = o.hitCount ?? 0;
    totalSamples += hit;
    nodes.set(o.id, {
      id: o.id,
      function: o.function ?? `fn${o.id}`,
      file: 'src/x.ts',
      line: o.id,
      column: 1,
      category: o.category,
      hitCount: hit,
      children: [],
      optimizationState: 'unknown',
    });
  }
  return {
    nodes,
    rootId: 0,
    parentOf: new Map(),
    totalSamples,
    totalMs: totalSamples * sampleIntervalMs,
    sampleIntervalMs,
  };
}

function makeHotspot(over: Partial<Hotspot> = {}): Hotspot {
  return {
    id: over.id ?? `${over.file ?? 'src/a.ts'}:${over.line ?? 10}:${over.function ?? 'foo'}`,
    function: 'foo',
    file: 'src/a.ts',
    line: 10,
    column: 1,
    category: 'user',
    selfPct: 0,
    totalPct: 0,
    selfMs: 0,
    totalMs: 0,
    selfSamples: 0,
    totalSamples: 0,
    optimizationState: 'unknown',
    ...over,
  } as Hotspot;
}

describe('buildCpuSummary', () => {
  it('computes ratios on the on-CPU denominator (excluding idle/program)', () => {
    const tree = makeTree([
      { id: 1, category: 'user', hitCount: 60 },
      { id: 2, category: 'node_modules', hitCount: 20 },
      { id: 3, category: 'idle', hitCount: 20 },
    ]);
    const summary = buildCpuSummary(tree);
    // total=100; idle=20; onCpu=80
    expect(summary.idleRatio).toBeCloseTo(0.2, 5);
    expect(summary.onCpuRatio).toBeCloseTo(0.8, 5);
    expect(summary.userCodeRatio).toBeCloseTo(60 / 80, 5);
    expect(summary.nodeModulesRatio).toBeCloseTo(20 / 80, 5);
    expect(summary.totalCpuMs).toBe(80 * tree.sampleIntervalMs);
  });

  it('treats program samples as idle', () => {
    const tree = makeTree([
      { id: 1, category: 'user', hitCount: 50 },
      { id: 2, category: 'program', hitCount: 50 },
    ]);
    const summary = buildCpuSummary(tree);
    expect(summary.idleRatio).toBeCloseTo(0.5, 5);
    // userCodeRatio uses on-CPU denominator (50 user / 50 onCpu) = 1
    expect(summary.userCodeRatio).toBeCloseTo(1, 5);
  });

  it('clamps onCpu denominator to 1 when there is no on-CPU activity', () => {
    const tree = makeTree([{ id: 1, category: 'idle', hitCount: 10 }]);
    const summary = buildCpuSummary(tree);
    // No on-CPU samples → ratios come out as 0 (numerator 0, denom clamped to 1)
    expect(summary.userCodeRatio).toBe(0);
    expect(summary.totalCpuMs).toBe(0);
  });

  it('subtracts noise frames from the total samples by default', () => {
    const tree = makeTree([
      { id: 1, category: 'user', hitCount: 50 },
      { id: 2, category: 'lanterna', hitCount: 50 }, // noise
    ]);
    const summary = buildCpuSummary(tree);
    // totalSamples 100 - lanterna 50 = 50; user/onCpu = 50/50 = 1
    expect(summary.userCodeRatio).toBeCloseTo(1, 5);
  });

  it('selects the topCategory by highest on-CPU sample count', () => {
    const tree = makeTree([
      { id: 1, category: 'user', hitCount: 30 },
      { id: 2, category: 'native', hitCount: 60 },
      { id: 3, category: 'idle', hitCount: 100 }, // not eligible
    ]);
    const summary = buildCpuSummary(tree);
    expect(summary.topCategory).toBe('native');
  });

  it('initialises dominantBlockingKind to null (set later by finalize)', () => {
    const tree = makeTree([{ id: 1, category: 'user', hitCount: 10 }]);
    expect(buildCpuSummary(tree).dominantBlockingKind).toBeNull();
  });
});

describe('deriveDominantBlockingKind', () => {
  it('returns sync-crypto when present (highest priority)', () => {
    const findings = [
      { category: 'blocking-io' },
      { category: 'sync-crypto' },
      { category: 'json-on-hot-path' },
    ] as LanternaReport['findings'];
    expect(deriveDominantBlockingKind(findings)).toBe('sync-crypto');
  });

  it('returns blocking-io when sync-crypto is absent', () => {
    const findings = [
      { category: 'blocking-io' },
      { category: 'json-on-hot-path' },
    ] as LanternaReport['findings'];
    expect(deriveDominantBlockingKind(findings)).toBe('blocking-io');
  });

  it('returns null when neither is present', () => {
    const findings = [{ category: 'json-on-hot-path' }] as LanternaReport['findings'];
    expect(deriveDominantBlockingKind(findings)).toBeNull();
  });

  it('returns null on an empty list', () => {
    expect(deriveDominantBlockingKind([])).toBeNull();
  });
});

describe('deriveTopUserHotspot', () => {
  it('returns undefined when no hotspot meets the user threshold', () => {
    const hotspots = [
      makeHotspot({ category: 'user', selfPct: 5, totalPct: 5 }),
      makeHotspot({ category: 'native', selfPct: 90, totalPct: 90 }),
    ];
    expect(deriveTopUserHotspot(hotspots)).toBeUndefined();
  });

  it('keeps a user hotspot above 10% selfPct', () => {
    const hotspots = [makeHotspot({ category: 'user', selfPct: 12, totalPct: 8 })];
    const top = deriveTopUserHotspot(hotspots);
    expect(top?.function).toBe('foo');
  });

  it('keeps a user hotspot above 20% totalPct (cumulative)', () => {
    const hotspots = [makeHotspot({ category: 'user', selfPct: 1, totalPct: 22 })];
    expect(deriveTopUserHotspot(hotspots)).toBeDefined();
  });

  it('sorts by totalPct desc then selfPct desc', () => {
    const a = makeHotspot({
      category: 'user',
      function: 'a',
      file: 'a.ts',
      line: 1,
      selfPct: 12,
      totalPct: 30,
    });
    const b = makeHotspot({
      category: 'user',
      function: 'b',
      file: 'b.ts',
      line: 2,
      selfPct: 25,
      totalPct: 30,
    });
    const c = makeHotspot({
      category: 'user',
      function: 'c',
      file: 'c.ts',
      line: 3,
      selfPct: 11,
      totalPct: 60,
    });
    const top = deriveTopUserHotspot([a, b, c]);
    expect(top?.function).toBe('c'); // highest totalPct
    expect(top?.alternativeHotspots).toHaveLength(2);
    expect(top?.alternativeHotspots?.[0]?.function).toBe('b'); // higher selfPct on tie
    expect(top?.alternativeHotspots?.[1]?.function).toBe('a');
  });

  it('attaches an event-loop correlation when the matching correlated hotspot exists', () => {
    const hotspot = makeHotspot({
      category: 'user',
      function: 'fn',
      file: 'src/a.ts',
      line: 42,
      selfPct: 50,
      totalPct: 50,
    });
    const correlated: CorrelatedHotspot = {
      id: 'src/a.ts:42:fn',
      function: 'fn',
      file: 'src/a.ts',
      line: 42,
      overlapPct: 75,
      samplePct: 50,
      rank: 1,
      confidence: 'high',
    };
    const top = deriveTopUserHotspot([hotspot], [correlated]);
    expect(top?.eventLoopCorrelation).toEqual({ overlapPct: 75, samplePct: 50 });
  });

  it('omits hotspots already explained by a specific finding (sync-crypto)', () => {
    const cryptoHotspot = makeHotspot({
      category: 'user',
      function: 'hashPassword',
      file: 'src/auth.ts',
      line: 5,
      selfPct: 15,
      totalPct: 30,
    });
    const otherHotspot = makeHotspot({
      category: 'user',
      function: 'serialize',
      file: 'src/x.ts',
      line: 9,
      selfPct: 12,
      totalPct: 25,
    });
    const findings = [
      {
        category: 'sync-crypto',
        evidence: {
          file: 'src/auth.ts',
          line: 5,
          function: 'hashPassword',
        },
      },
    ] as unknown as LanternaReport['findings'];
    const top = deriveTopUserHotspot([cryptoHotspot, otherHotspot], [], findings);
    expect(top?.function).toBe('serialize');
  });

  it('falls back to explained user hotspots instead of returning no lead', () => {
    const cryptoHotspot = makeHotspot({
      category: 'user',
      function: 'hashPassword',
      file: 'src/auth.ts',
      line: 5,
      selfPct: 15,
      totalPct: 30,
    });
    const findings = [
      {
        category: 'sync-crypto',
        evidence: {
          file: 'src/auth.ts',
          line: 5,
          function: 'hashPassword',
        },
      },
    ] as unknown as LanternaReport['findings'];

    const top = deriveTopUserHotspot([cryptoHotspot], [], findings);

    expect(top?.function).toBe('hashPassword');
  });

  it('can derive a user hotspot from finding candidate callers when public hotspots omit it', () => {
    const findings = [
      {
        category: 'sync-crypto',
        evidence: {
          file: 'node:internal/crypto/pbkdf2',
          line: 62,
          function: 'pbkdf2Sync',
          extra: {
            candidateCallers: [
              {
                function: 'hashPassword',
                file: 'src/auth.ts',
                line: 5,
                profilePct: 80,
                supportPct: 100,
                confidence: 'high',
                basis: 'cpu-sample-path',
              },
              {
                function: 'processBatch',
                file: 'src/batch.ts',
                line: 12,
                profilePct: 80,
                supportPct: 100,
                confidence: 'high',
                basis: 'cpu-sample-path',
              },
            ],
          },
        },
      },
    ] as unknown as LanternaReport['findings'];

    const top = deriveTopUserHotspot([], [], findings);

    expect(top?.function).toBe('hashPassword');
    expect(top?.alternativeHotspots?.[0]?.function).toBe('processBatch');
  });

  it('prefers named correlated hotspots over anonymous wrappers', () => {
    const wrapper = makeHotspot({
      category: 'user',
      function: '(anonymous)',
      file: 'src/app.js',
      line: 1,
      selfPct: 5,
      totalPct: 95,
    });
    const named = makeHotspot({
      category: 'user',
      function: 'processBatch',
      file: 'src/app.js',
      line: 12,
      selfPct: 12,
      totalPct: 55,
    });
    const correlated: CorrelatedHotspot = {
      id: 'src/app.js:12:processBatch',
      function: 'processBatch',
      file: 'src/app.js',
      line: 12,
      overlapPct: 70,
      samplePct: 50,
      rank: 1,
      confidence: 'high',
    };

    const top = deriveTopUserHotspot([wrapper, named], [correlated]);

    expect(top?.function).toBe('processBatch');
    expect(top?.eventLoopCorrelation).toEqual({ overlapPct: 70, samplePct: 50 });
  });

  it('forwards the source location when set on the hotspot', () => {
    const hotspot = makeHotspot({
      category: 'user',
      function: 'fn',
      selfPct: 50,
      totalPct: 50,
      source: { file: 'src/orig.ts', line: 7, column: 1 },
    });
    expect(deriveTopUserHotspot([hotspot])?.source).toEqual({
      file: 'src/orig.ts',
      line: 7,
      column: 1,
    });
  });
});

describe('deriveTopCpuCulprit', () => {
  it('returns the self-heavy user frame', () => {
    const wrapper = makeHotspot({
      category: 'user',
      function: 'processBatch',
      file: 'src/batch.ts',
      line: 7,
      selfPct: 0.04,
      totalPct: 99,
    });
    const compute = makeHotspot({
      category: 'user',
      function: 'scoreRecommendations',
      file: 'src/search.ts',
      line: 13,
      selfPct: 70,
      totalPct: 75,
    });

    expect(deriveTopCpuCulprit([wrapper, compute])?.function).toBe('scoreRecommendations');
  });

  it('does not report an inclusive-only wrapper as the CPU culprit', () => {
    const wrapper = makeHotspot({
      category: 'user',
      function: 'processBatch',
      file: 'src/batch.ts',
      line: 7,
      selfPct: 0.04,
      totalPct: 99,
    });
    const caller = makeHotspot({
      category: 'user',
      function: 'hashPassword',
      file: 'src/auth.ts',
      line: 3,
      selfPct: 0.01,
      totalPct: 98,
    });

    expect(deriveTopCpuCulprit([wrapper, caller])).toBeUndefined();
  });
});
