import type { RawCpuProfile } from '../../capture/core/types.js';
import type {
  FrameCategory,
  Hotspot,
  HotspotRef,
  OptimizationState,
  SourceLocation,
  UserCallerAttribution,
} from '../../report/types.js';
import { isNoiseCategory, shouldKeepNoiseFrames } from '../noise-filters.js';
import type { SourceMapResolver } from '../sourcemap/resolver.js';
import { classifyFrame } from './classify.js';

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
  source?: SourceLocation;
}

export interface EnrichedTree {
  nodes: Map<number, NodeEnriched>;
  rootId: number;
  parentOf: Map<number, number>;
  totalSamples: number;
  totalMs: number;
  sampleIntervalMs: number;
}

export interface HotspotAnalysis {
  publicHotspots: Hotspot[];
  fullHotspots: Hotspot[];
  hotspotById: Map<string, Hotspot>;
  userCallerById: Map<string, UserCallerAttribution>;
  candidateCallersById: Map<string, UserCallerAttribution[]>;
}

const ATTRIBUTION_HIGH_CONFIDENCE_SUPPORT_PCT = 80;
const ATTRIBUTION_MEDIUM_CONFIDENCE_SUPPORT_PCT = 25;

interface HotspotAggregate {
  id: string;
  function: string;
  file: string;
  line: number;
  column: number;
  category: FrameCategory;
  package?: string;
  selfSamples: number;
  totalSamples: number;
  selfMs: number;
  totalMs: number;
  optimizationState: OptimizationState;
  callerSamples: Map<string, number>;
  calleeSamples: Map<string, number>;
  pathSamples: number;
  userAncestorSamples: Map<string, number>;
  candidateUserAncestorSamples: Map<string, number>;
  candidateUserAncestorDistance: Map<string, number>;
  sourceNodeIds: Set<number>;
  source?: SourceLocation;
}

export function enrichCpuTree(
  profile: RawCpuProfile,
  cwd: string,
  sampleIntervalMicros: number,
  sourceMaps?: SourceMapResolver,
): EnrichedTree {
  const nodes = new Map<number, NodeEnriched>();
  const parentOf = new Map<number, number>();
  let rootId = -1;

  if (sourceMaps) {
    const uniqueUrls = new Set<string>();
    for (const raw of profile.nodes) {
      if (raw.callFrame.url) uniqueUrls.add(raw.callFrame.url);
    }
    sourceMaps.prepare(uniqueUrls);
  }

  for (const raw of profile.nodes) {
    const classification = classifyFrame(
      raw.callFrame.functionName || '(anonymous)',
      raw.callFrame.url || '',
      cwd,
    );
    const line = raw.callFrame.lineNumber + 1;
    const column = raw.callFrame.columnNumber + 1;
    const node: NodeEnriched = {
      id: raw.id,
      function: raw.callFrame.functionName || '(anonymous)',
      file: classification.file,
      line,
      column,
      category: classification.category,
      hitCount: raw.hitCount ?? 0,
      children: raw.children ?? [],
      optimizationState: detectOptState(raw.callFrame.functionName),
      deoptReason: raw.deoptReason,
    };
    if (classification.package) node.package = classification.package;
    if (sourceMaps && raw.callFrame.url) {
      const source = sourceMaps.resolve(raw.callFrame.url, line, column);
      if (source) node.source = source;
    }
    nodes.set(raw.id, node);
    if (rootId === -1 || raw.callFrame.functionName === '(root)') rootId = raw.id;
  }

  for (const node of nodes.values()) {
    for (const childId of node.children) parentOf.set(childId, node.id);
  }

  let totalSamples = 0;
  for (const node of nodes.values()) totalSamples += node.hitCount;

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

function detectOptState(functionName: string): OptimizationState {
  if (functionName.startsWith('*')) return 'optimized';
  if (functionName.startsWith('~')) return 'interpreted';
  return 'unknown';
}

export function buildHotspotAnalysis(
  profile: RawCpuProfile,
  tree: EnrichedTree,
  topN = 25,
): HotspotAnalysis {
  // ── Phase 1: Build aggregate map ──────────────────────────────────────────
  // Group all tree nodes by their logical call frame (file + function + line).
  // Multiple node IDs can share the same frame when the function appears at
  // different depths in the call tree; we merge them into a single aggregate.
  const hotspotAggregatesByKey = new Map<string, HotspotAggregate>();
  const aggregateKeyByNodeId = new Map<number, string>();

  for (const node of tree.nodes.values()) {
    const aggregateKey = `${node.file}|${node.function}|${node.line}`;
    aggregateKeyByNodeId.set(node.id, aggregateKey);
    let aggregate = hotspotAggregatesByKey.get(aggregateKey);
    if (!aggregate) {
      aggregate = {
        id: makeHotspotId(node.file, node.line, node.function),
        function: node.function,
        file: node.file,
        line: node.line,
        column: node.column,
        category: node.category,
        selfSamples: 0,
        totalSamples: 0,
        selfMs: 0,
        totalMs: 0,
        optimizationState: node.optimizationState,
        callerSamples: new Map(),
        calleeSamples: new Map(),
        pathSamples: 0,
        userAncestorSamples: new Map(),
        candidateUserAncestorSamples: new Map(),
        candidateUserAncestorDistance: new Map(),
        sourceNodeIds: new Set(),
      };
      if (node.package) aggregate.package = node.package;
      if (node.source) aggregate.source = node.source;
      hotspotAggregatesByKey.set(aggregateKey, aggregate);
    } else if (!aggregate.source && node.source) {
      aggregate.source = node.source;
    }
    aggregate.selfSamples += node.hitCount;
    aggregate.sourceNodeIds.add(node.id);
  }

  // ── Phase 2: Walk sample paths ────────────────────────────────────────────
  // For each leaf sample, walk the call path upward to build caller/callee
  // relationships and track which user-code ancestor is nearest to each
  // non-user frame (used later for attribution scoring).
  const totalSamples = Math.max(1, tree.totalSamples);
  const sampleLeafIds = profile.samples ?? [];
  const sampleDurationsMs = buildSampleDurationsMs(profile, tree.sampleIntervalMs);
  if (sampleLeafIds.length > 0) {
    for (let sampleIndex = 0; sampleIndex < sampleLeafIds.length; sampleIndex++) {
      const leafId = sampleLeafIds[sampleIndex];
      if (leafId === undefined) continue;
      const sampleDurationMs = sampleDurationsMs[sampleIndex] ?? tree.sampleIntervalMs;
      const leafAggregateKey = aggregateKeyByNodeId.get(leafId);
      if (leafAggregateKey) {
        const leafAggregate = hotspotAggregatesByKey.get(leafAggregateKey);
        if (leafAggregate) leafAggregate.selfMs += sampleDurationMs;
      }
      const aggregatePath = buildAggregatedPath(leafId, tree, aggregateKeyByNodeId);
      if (aggregatePath.length === 0) continue;

      for (let pathIndex = 0; pathIndex < aggregatePath.length - 1; pathIndex++) {
        const childAggregateKey = aggregatePath[pathIndex];
        const parentAggregateKey = aggregatePath[pathIndex + 1];
        if (childAggregateKey === undefined || parentAggregateKey === undefined) continue;
        if (childAggregateKey === parentAggregateKey) continue;
        const childAggregate = hotspotAggregatesByKey.get(childAggregateKey);
        const parentAggregate = hotspotAggregatesByKey.get(parentAggregateKey);
        if (!childAggregate || !parentAggregate) continue;
        childAggregate.callerSamples.set(
          parentAggregateKey,
          (childAggregate.callerSamples.get(parentAggregateKey) ?? 0) + 1,
        );
        parentAggregate.calleeSamples.set(
          childAggregateKey,
          (parentAggregate.calleeSamples.get(childAggregateKey) ?? 0) + 1,
        );
      }

      for (const aggregateKey of new Set(aggregatePath)) {
        const aggregate = hotspotAggregatesByKey.get(aggregateKey);
        if (!aggregate) continue;
        aggregate.pathSamples += 1;
        aggregate.totalMs += sampleDurationMs;
      }

      const userAncestorKeys: string[] = [];
      for (const aggregateKey of [...aggregatePath].reverse()) {
        const aggregate = hotspotAggregatesByKey.get(aggregateKey);
        if (!aggregate) continue;
        if (aggregate.category === 'user') {
          userAncestorKeys.push(aggregateKey);
          continue;
        }
        if (userAncestorKeys.length === 0) continue;
        const nearestUserAncestorKey = userAncestorKeys[userAncestorKeys.length - 1];
        if (!nearestUserAncestorKey) continue;
        aggregate.userAncestorSamples.set(
          nearestUserAncestorKey,
          (aggregate.userAncestorSamples.get(nearestUserAncestorKey) ?? 0) + 1,
        );
        for (let ancestorIndex = 0; ancestorIndex < userAncestorKeys.length; ancestorIndex += 1) {
          const userAncestorKey = userAncestorKeys[ancestorIndex];
          if (!userAncestorKey) continue;
          const stackDistance = userAncestorKeys.length - ancestorIndex;
          aggregate.candidateUserAncestorSamples.set(
            userAncestorKey,
            (aggregate.candidateUserAncestorSamples.get(userAncestorKey) ?? 0) + 1,
          );
          const previousDistance = aggregate.candidateUserAncestorDistance.get(userAncestorKey);
          if (previousDistance === undefined || stackDistance < previousDistance) {
            aggregate.candidateUserAncestorDistance.set(userAncestorKey, stackDistance);
          }
        }
      }
    }
  }

  for (const aggregate of hotspotAggregatesByKey.values()) {
    if (sampleLeafIds.length > 0) {
      aggregate.totalSamples = aggregate.pathSamples;
      continue;
    }
    let aggregateTotalSamples = 0;
    for (const nodeId of aggregate.sourceNodeIds) {
      aggregateTotalSamples += subtreeSamples(tree, nodeId);
    }
    aggregate.totalSamples = aggregateTotalSamples;
    aggregate.selfMs = aggregate.selfSamples * tree.sampleIntervalMs;
    aggregate.totalMs = aggregate.totalSamples * tree.sampleIntervalMs;
  }

  // ── Phase 3: Materialize aggregates into Hotspot objects ─────────────────
  // Convert each aggregate into a public Hotspot. For non-user frames, find
  // the top user-code ancestor by sample count and record it as the
  // attribution (confidence is 'high' when that ancestor appears on ≥80% of
  // the frame's call paths).
  const fullHotspots: Hotspot[] = [];
  const hotspotById = new Map<string, Hotspot>();
  const userCallerById = new Map<string, UserCallerAttribution>();
  const candidateCallersById = new Map<string, UserCallerAttribution[]>();
  const keepNoise = shouldKeepNoiseFrames();
  for (const aggregate of hotspotAggregatesByKey.values()) {
    if (aggregate.selfSamples === 0 && aggregate.totalSamples === 0) continue;
    if (isPseudoFrame(aggregate.function)) continue;
    if (isNoiseCategory(aggregate.category) && !keepNoise) continue;
    const hotspot: Hotspot = {
      id: aggregate.id,
      function: aggregate.function,
      file: aggregate.file,
      line: aggregate.line,
      column: aggregate.column,
      category: aggregate.category,
      selfMs: aggregate.selfMs,
      selfPct: (aggregate.selfSamples / totalSamples) * 100,
      totalMs: aggregate.totalMs,
      totalPct: (aggregate.totalSamples / totalSamples) * 100,
      callers: topRefs(aggregate.callerSamples, hotspotAggregatesByKey, totalSamples, 3),
      callees: topRefs(aggregate.calleeSamples, hotspotAggregatesByKey, totalSamples, 3),
      optimizationState: aggregate.optimizationState,
    };
    if (aggregate.package) hotspot.package = aggregate.package;
    if (aggregate.source) hotspot.source = aggregate.source;
    fullHotspots.push(hotspot);
    hotspotById.set(hotspot.id, hotspot);

    const candidateCallers = buildUserCallerCandidates(
      aggregate,
      hotspotAggregatesByKey,
      totalSamples,
    );
    if (candidateCallers.length === 0) continue;
    candidateCallersById.set(hotspot.id, candidateCallers);
    const userCaller = candidateCallers[0];
    if (!userCaller) continue;
    userCallerById.set(hotspot.id, userCaller);
    if (hotspot.category !== 'user') {
      hotspot.userCaller = userCaller;
    }
  }

  fullHotspots.sort((left, right) => right.selfPct - left.selfPct);
  const publicHotspots = fullHotspots
    .filter((hotspot) => !isNoiseCategory(hotspot.category))
    .slice(0, topN);
  return {
    publicHotspots,
    fullHotspots,
    hotspotById,
    userCallerById,
    candidateCallersById,
  };
}

function buildUserCallerCandidates(
  aggregate: HotspotAggregate,
  hotspotAggregatesByKey: Map<string, HotspotAggregate>,
  totalSamples: number,
): UserCallerAttribution[] {
  const totalPathSamples = Math.max(1, aggregate.pathSamples || aggregate.totalSamples);
  const candidates = Array.from(aggregate.candidateUserAncestorSamples.entries())
    .sort((left, right) => {
      const distanceDelta =
        (aggregate.candidateUserAncestorDistance.get(left[0]) ?? Number.MAX_SAFE_INTEGER) -
        (aggregate.candidateUserAncestorDistance.get(right[0]) ?? Number.MAX_SAFE_INTEGER);
      if (distanceDelta !== 0) return distanceDelta;
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) return countDelta;
      return (
        (aggregate.userAncestorSamples.get(right[0]) ?? 0) -
        (aggregate.userAncestorSamples.get(left[0]) ?? 0)
      );
    })
    .flatMap(([userAggregateKey, attributedSampleCount]) => {
      const userHotspotAggregate = hotspotAggregatesByKey.get(userAggregateKey);
      if (!userHotspotAggregate) return [];
      const supportPct = (attributedSampleCount / totalPathSamples) * 100;
      const userCaller: UserCallerAttribution = {
        function: userHotspotAggregate.function,
        file: userHotspotAggregate.file,
        line: userHotspotAggregate.line,
        column: userHotspotAggregate.column,
        stackDistance: aggregate.candidateUserAncestorDistance.get(userAggregateKey),
        profilePct: (attributedSampleCount / totalSamples) * 100,
        supportPct,
        confidence: attributionConfidenceForSupport(supportPct),
        basis: 'cpu-sample-path',
      };
      if (userHotspotAggregate.source) userCaller.source = userHotspotAggregate.source;
      return [userCaller];
    });
  return candidates.some((candidate) => !isAnonymousUserCaller(candidate))
    ? candidates.filter((candidate) => !isAnonymousUserCaller(candidate))
    : candidates;
}

function attributionConfidenceForSupport(supportPct: number): 'low' | 'medium' | 'high' {
  if (supportPct >= ATTRIBUTION_HIGH_CONFIDENCE_SUPPORT_PCT) return 'high';
  if (supportPct >= ATTRIBUTION_MEDIUM_CONFIDENCE_SUPPORT_PCT) return 'medium';
  return 'low';
}

function isAnonymousUserCaller(candidate: UserCallerAttribution): boolean {
  return candidate.function === '(anonymous)' || candidate.function.trim() === '';
}

function buildSampleDurationsMs(profile: RawCpuProfile, fallbackMs: number): number[] {
  const sampleCount = profile.samples?.length ?? 0;
  if (sampleCount === 0) return [];
  const deltas = profile.timeDeltas;
  if (!deltas || deltas.length !== sampleCount) {
    return Array.from({ length: sampleCount }, () => fallbackMs);
  }
  return deltas.map((deltaUs) => deltaUs / 1000);
}

function topRefs(
  samplesByAggregateKey: Map<string, number>,
  hotspotAggregatesByKey: Map<string, { id: string }>,
  totalSamples: number,
  limit: number,
): HotspotRef[] {
  return Array.from(samplesByAggregateKey.entries())
    .map(([aggregateKey, sampleCount]) => ({
      id: hotspotAggregatesByKey.get(aggregateKey)?.id ?? aggregateKey,
      pct: (sampleCount / totalSamples) * 100,
    }))
    .sort((left, right) => right.pct - left.pct)
    .slice(0, limit);
}

function subtreeSamples(tree: EnrichedTree, rootId: number): number {
  let totalSamples = 0;
  const pendingNodeIds: number[] = [rootId];
  while (pendingNodeIds.length) {
    const nodeId = pendingNodeIds.pop();
    if (nodeId === undefined) continue;
    const node = tree.nodes.get(nodeId);
    if (!node) continue;
    totalSamples += node.hitCount;
    for (const childId of node.children) pendingNodeIds.push(childId);
  }
  return totalSamples;
}

function buildAggregatedPath(
  leafId: number,
  tree: EnrichedTree,
  aggregateKeyByNodeId: Map<number, string>,
): string[] {
  const aggregatePath: string[] = [];
  let currentNodeId: number | undefined = leafId;
  const visitedNodeIds = new Set<number>();
  while (currentNodeId !== undefined && !visitedNodeIds.has(currentNodeId)) {
    visitedNodeIds.add(currentNodeId);
    const aggregateKey = aggregateKeyByNodeId.get(currentNodeId);
    if (aggregateKey && aggregatePath[aggregatePath.length - 1] !== aggregateKey) {
      aggregatePath.push(aggregateKey);
    }
    currentNodeId = tree.parentOf.get(currentNodeId);
  }
  return aggregatePath;
}

function makeHotspotId(file: string, line: number, functionName: string): string {
  return `${file}:${line}:${functionName}`;
}

function isPseudoFrame(functionName: string): boolean {
  return functionName === '(root)' || functionName === '(idle)' || functionName === '(program)';
}
