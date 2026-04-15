import type { RawCpuProfile } from '../collector/source.js';
import type { FrameCategory, Hotspot, HotspotRef, OptimizationState } from '../report/types.js';
import { classifyFrame, type ClassifiedFrame } from './classify.js';

export interface NodeEnriched {
  id: number;
  function: string;
  file: string;
  line: number;
  column: number;
  category: FrameCategory;
  package?: string;
  hitCount: number;
  children: number[];
  optimizationState: OptimizationState;
  deoptReason?: string;
}

export interface EnrichedTree {
  nodes: Map<number, NodeEnriched>;
  rootId: number;
  parentOf: Map<number, number>;
  totalSamples: number;
  totalMs: number;
  sampleIntervalMs: number;
}

export interface HotspotAttribution {
  hotspotId: string;
  function: string;
  file: string;
  line: number;
  samplePct: number;
  supportPct: number;
  confidence: 'low' | 'high';
}

export interface HotspotAnalysis {
  publicHotspots: Hotspot[];
  fullHotspots: Hotspot[];
  hotspotById: Map<string, Hotspot>;
  userAttributionById: Map<string, HotspotAttribution>;
}

export function enrichCpuTree(
  profile: RawCpuProfile,
  cwd: string,
  sampleIntervalMicros: number,
): EnrichedTree {
  const nodes = new Map<number, NodeEnriched>();
  const parentOf = new Map<number, number>();
  let rootId = -1;

  for (const raw of profile.nodes) {
    const c = classifyFrame(raw.callFrame.functionName || '(anonymous)', raw.callFrame.url || '', cwd);
    const node: NodeEnriched = {
      id: raw.id,
      function: raw.callFrame.functionName || '(anonymous)',
      file: c.file,
      line: raw.callFrame.lineNumber + 1,
      column: raw.callFrame.columnNumber + 1,
      category: c.category,
      hitCount: raw.hitCount ?? 0,
      children: raw.children ?? [],
      optimizationState: detectOptState(raw.callFrame.functionName, c),
      deoptReason: raw.deoptReason,
    };
    if (c.package) node.package = c.package;
    nodes.set(raw.id, node);
    if (rootId === -1 || raw.callFrame.functionName === '(root)') rootId = raw.id;
  }

  for (const n of nodes.values()) {
    for (const child of n.children) parentOf.set(child, n.id);
  }

  let totalSamples = 0;
  for (const n of nodes.values()) totalSamples += n.hitCount;

  const sampleIntervalMs = sampleIntervalMicros / 1000;
  return {
    nodes,
    rootId: rootId === -1 ? 1 : rootId,
    parentOf,
    totalSamples,
    totalMs: totalSamples * sampleIntervalMs,
    sampleIntervalMs,
  };
}

function detectOptState(functionName: string, _c: ClassifiedFrame): OptimizationState {
  // V8 prefixes optimized functions with "*" and interpreted with "~" in some outputs,
  // but .cpuprofile callFrame does not expose this. We default to unknown and only
  // infer when we see a clear prefix.
  if (functionName.startsWith('*')) return 'optimized';
  if (functionName.startsWith('~')) return 'interpreted';
  return 'unknown';
}

export function aggregateHotspots(
  profile: RawCpuProfile,
  tree: EnrichedTree,
  topN = 25,
): HotspotAnalysis {
  // Aggregate by (file, function, line) across all node ids that share a call frame.
  type Agg = {
    id: string;
    function: string;
    file: string;
    line: number;
    column: number;
    category: FrameCategory;
    package?: string;
    selfSamples: number;
    totalSamples: number;
    optimizationState: OptimizationState;
    callerSamples: Map<string, number>;
    calleeSamples: Map<string, number>;
    pathSamples: number;
    userAncestorSamples: Map<string, number>;
    keyNodeIds: Set<number>;
  };

  const byKey = new Map<string, Agg>();
  const nodeKey = new Map<number, string>();

  for (const n of tree.nodes.values()) {
    const key = `${n.file}|${n.function}|${n.line}`;
    nodeKey.set(n.id, key);
    let a = byKey.get(key);
    if (!a) {
      a = {
        id: makeHotspotId(n.file, n.line, n.function),
        function: n.function,
        file: n.file,
        line: n.line,
        column: n.column,
        category: n.category,
        selfSamples: 0,
        totalSamples: 0,
        optimizationState: n.optimizationState,
        callerSamples: new Map(),
        calleeSamples: new Map(),
        pathSamples: 0,
        userAncestorSamples: new Map(),
        keyNodeIds: new Set(),
      };
      if (n.package) a.package = n.package;
      byKey.set(key, a);
    }
    a.selfSamples += n.hitCount;
    a.keyNodeIds.add(n.id);
  }

  const total = Math.max(1, tree.totalSamples);
  const sampleLeafIds = profile.samples ?? [];
  if (sampleLeafIds.length > 0) {
    for (const leafId of sampleLeafIds) {
      const path = buildAggregatedPath(leafId, tree, nodeKey);
      if (path.length === 0) continue;

      for (let i = 0; i < path.length - 1; i++) {
        const childKey = path[i]!;
        const parentKey = path[i + 1]!;
        if (childKey === parentKey) continue;
        const childAgg = byKey.get(childKey);
        const parentAgg = byKey.get(parentKey);
        if (!childAgg || !parentAgg) continue;
        childAgg.callerSamples.set(parentKey, (childAgg.callerSamples.get(parentKey) ?? 0) + 1);
        parentAgg.calleeSamples.set(childKey, (parentAgg.calleeSamples.get(childKey) ?? 0) + 1);
      }

      for (const key of new Set(path)) {
        byKey.get(key)!.pathSamples += 1;
      }

      let nearestUserAncestorKey: string | undefined;
      for (const key of [...path].reverse()) {
        const agg = byKey.get(key)!;
        if (agg.category === 'user') {
          nearestUserAncestorKey = key;
          continue;
        }
        if (!nearestUserAncestorKey) continue;
        agg.userAncestorSamples.set(
          nearestUserAncestorKey,
          (agg.userAncestorSamples.get(nearestUserAncestorKey) ?? 0) + 1,
        );
      }
    }
  }

  for (const a of byKey.values()) {
    if (sampleLeafIds.length > 0) {
      a.totalSamples = a.pathSamples;
      continue;
    }
    let totalSamples = 0;
    for (const nodeId of a.keyNodeIds) {
      totalSamples += subtreeSamples(tree, nodeId);
    }
    a.totalSamples = totalSamples;
  }

  const fullHotspots: Hotspot[] = [];
  const hotspotById = new Map<string, Hotspot>();
  const userAttributionById = new Map<string, HotspotAttribution>();
  for (const a of byKey.values()) {
    if (a.selfSamples === 0 && a.totalSamples === 0) continue;
    if (isPseudoFrame(a.function)) continue;
    const h: Hotspot = {
      id: a.id,
      function: a.function,
      file: a.file,
      line: a.line,
      column: a.column,
      category: a.category,
      selfMs: a.selfSamples * tree.sampleIntervalMs,
      selfPct: (a.selfSamples / total) * 100,
      totalMs: a.totalSamples * tree.sampleIntervalMs,
      totalPct: (a.totalSamples / total) * 100,
      callers: topRefs(a.callerSamples, byKey, total, 3),
      callees: topRefs(a.calleeSamples, byKey, total, 3),
      optimizationState: a.optimizationState,
    };
    if (a.package) h.package = a.package;
    fullHotspots.push(h);
    hotspotById.set(h.id, h);

    const totalPathSamples = Math.max(1, a.pathSamples || a.totalSamples);
    const topUserAttribution = Array.from(a.userAncestorSamples.entries())
      .sort((x, y) => y[1] - x[1])[0];
    if (!topUserAttribution) continue;
    const [userKey, count] = topUserAttribution;
    const userHotspot = byKey.get(userKey);
    if (!userHotspot) continue;
    userAttributionById.set(h.id, {
      hotspotId: `${userHotspot.file}:${userHotspot.line}:${userHotspot.function}`,
      function: userHotspot.function,
      file: userHotspot.file,
      line: userHotspot.line,
      samplePct: (count / total) * 100,
      supportPct: (count / totalPathSamples) * 100,
      confidence: count / totalPathSamples >= 0.8 ? 'high' : 'low',
    });
  }

  fullHotspots.sort((x, y) => y.selfPct - x.selfPct);
  return {
    publicHotspots: fullHotspots.slice(0, topN),
    fullHotspots,
    hotspotById,
    userAttributionById,
  };
}

function topRefs(
  samples: Map<string, number>,
  byKey: Map<string, { id: string }>,
  total: number,
  n: number,
): HotspotRef[] {
  return Array.from(samples.entries())
    .map(([key, count]) => ({
      id: byKey.get(key)?.id ?? key,
      pct: (count / total) * 100,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, n);
}

function subtreeSamples(tree: EnrichedTree, rootId: number): number {
  let sum = 0;
  const stack: number[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const n = tree.nodes.get(id);
    if (!n) continue;
    sum += n.hitCount;
    for (const c of n.children) stack.push(c);
  }
  return sum;
}

function buildAggregatedPath(
  leafId: number,
  tree: EnrichedTree,
  nodeKey: Map<number, string>,
): string[] {
  const path: string[] = [];
  let current: number | undefined = leafId;
  const seen = new Set<number>();
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const key = nodeKey.get(current);
    if (key && path[path.length - 1] !== key) {
      path.push(key);
    }
    current = tree.parentOf.get(current);
  }
  return path;
}

function makeHotspotId(file: string, line: number, fn: string): string {
  return `${file}:${line}:${fn}`;
}

function isPseudoFrame(fn: string): boolean {
  return fn === '(root)' || fn === '(idle)' || fn === '(program)';
}
