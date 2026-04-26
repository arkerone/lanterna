import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CdpClient } from '../../inspector/client.js';

export type HeapSnapshotSuspectedPattern =
  | 'closure'
  | 'event-listener'
  | 'timer'
  | 'cache'
  | 'unknown';

export interface HeapSnapshotAnalysisOptions {
  enabled?: boolean;
  outputDir?: string;
  maxRetainerDepth?: number;
  maxGroups?: number;
  maxPathsPerGroup?: number;
}

export interface NormalizedHeapSnapshotAnalysisOptions {
  enabled: boolean;
  outputDir?: string;
  maxRetainerDepth: number;
  maxGroups: number;
  maxPathsPerGroup: number;
}

export interface HeapSnapshotGrowthEntry {
  name: string;
  countDelta: number;
  selfSizeDeltaBytes: number;
  retainedSizeDeltaBytes: number;
}

export interface HeapSnapshotRetainerPath {
  constructorName: string;
  retainedBytes: number;
  path: string[];
  suspectedPattern: HeapSnapshotSuspectedPattern;
  confidence: 'low' | 'medium' | 'high';
}

export interface HeapSnapshotAnalysisReport {
  available: boolean;
  mode: 'start-end';
  start: { path: string };
  end: { path: string };
  summary: {
    totalRetainedGrowthBytes: number;
    topGrowingConstructor?: string;
  };
  growthByConstructor: HeapSnapshotGrowthEntry[];
  retainerPaths: HeapSnapshotRetainerPath[];
  warnings: string[];
}

export interface CapturedHeapSnapshots {
  available: boolean;
  mode: 'start-end';
  start: { path: string };
  end: { path: string };
  warnings: string[];
}

export interface HeapSnapshotNode {
  index: number;
  type: string;
  name: string;
  id: number;
  selfSize: number;
  outgoing: HeapSnapshotEdge[];
  incomingStrong: HeapSnapshotEdge[];
  retainedSize: number;
}

export interface HeapSnapshotEdge {
  type: string;
  name: string;
  from: number;
  to: number;
}

export interface ParsedHeapSnapshot {
  nodes: HeapSnapshotNode[];
  rootIndex: number;
  warnings: string[];
}

interface RawHeapSnapshot {
  snapshot?: {
    meta?: {
      node_fields?: string[];
      edge_fields?: string[];
      node_types?: unknown[];
      edge_types?: unknown[];
    };
  };
  nodes?: number[];
  edges?: number[];
  strings?: string[];
}

const DEFAULT_MAX_RETAINER_DEPTH = 8;
const DEFAULT_MAX_GROUPS = 20;
const DEFAULT_MAX_PATHS_PER_GROUP = 3;
const WEAK_EDGE_TYPE = 'weak';

export function normalizeHeapSnapshotAnalysisOptions(
  options: HeapSnapshotAnalysisOptions | undefined,
): NormalizedHeapSnapshotAnalysisOptions {
  const enabled = options?.enabled ?? false;
  const maxRetainerDepth = options?.maxRetainerDepth ?? DEFAULT_MAX_RETAINER_DEPTH;
  const maxGroups = options?.maxGroups ?? DEFAULT_MAX_GROUPS;
  const maxPathsPerGroup = options?.maxPathsPerGroup ?? DEFAULT_MAX_PATHS_PER_GROUP;
  if (!Number.isInteger(maxRetainerDepth) || maxRetainerDepth < 1) {
    throw new Error(
      `invalid heap snapshot max retainer depth: ${maxRetainerDepth} (expected integer >= 1)`,
    );
  }
  if (!Number.isInteger(maxGroups) || maxGroups < 1) {
    throw new Error(`invalid heap snapshot max groups: ${maxGroups} (expected integer >= 1)`);
  }
  if (!Number.isInteger(maxPathsPerGroup) || maxPathsPerGroup < 1) {
    throw new Error(
      `invalid heap snapshot max paths per group: ${maxPathsPerGroup} (expected integer >= 1)`,
    );
  }
  return {
    enabled,
    ...(options?.outputDir ? { outputDir: options.outputDir } : {}),
    maxRetainerDepth,
    maxGroups,
    maxPathsPerGroup,
  };
}

export function parseHeapSnapshot(input: unknown): ParsedHeapSnapshot {
  const raw = input as RawHeapSnapshot;
  const meta = raw.snapshot?.meta;
  if (!meta || !raw.nodes || !raw.edges || !raw.strings) {
    throw new Error('invalid V8 heap snapshot: missing meta, nodes, edges, or strings');
  }
  const nodeFields = meta.node_fields ?? [];
  const edgeFields = meta.edge_fields ?? [];
  const nodeFieldCount = nodeFields.length;
  const edgeFieldCount = edgeFields.length;
  const nodeTypeNames = Array.isArray(meta.node_types?.[0]) ? (meta.node_types[0] as string[]) : [];
  const edgeTypeNames = Array.isArray(meta.edge_types?.[0]) ? (meta.edge_types[0] as string[]) : [];
  const nodeTypeOffset = requiredOffset(nodeFields, 'type');
  const nodeNameOffset = requiredOffset(nodeFields, 'name');
  const nodeIdOffset = requiredOffset(nodeFields, 'id');
  const nodeSelfSizeOffset = requiredOffset(nodeFields, 'self_size');
  const nodeEdgeCountOffset = requiredOffset(nodeFields, 'edge_count');
  const edgeTypeOffset = requiredOffset(edgeFields, 'type');
  const edgeNameOffset = requiredOffset(edgeFields, 'name_or_index');
  const edgeToNodeOffset = requiredOffset(edgeFields, 'to_node');

  const nodes: HeapSnapshotNode[] = [];
  for (let rawIndex = 0; rawIndex < raw.nodes.length; rawIndex += nodeFieldCount) {
    const index = rawIndex / nodeFieldCount;
    const typeIndex = raw.nodes[rawIndex + nodeTypeOffset] ?? -1;
    const nameIndex = raw.nodes[rawIndex + nodeNameOffset] ?? -1;
    nodes.push({
      index,
      type: nodeTypeNames[typeIndex] ?? String(typeIndex),
      name: raw.strings[nameIndex] ?? String(nameIndex),
      id: raw.nodes[rawIndex + nodeIdOffset] ?? index,
      selfSize: raw.nodes[rawIndex + nodeSelfSizeOffset] ?? 0,
      outgoing: [],
      incomingStrong: [],
      retainedSize: 0,
    });
  }

  let edgeCursor = 0;
  const warnings: string[] = [];
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    const nodeRawIndex = nodeIndex * nodeFieldCount;
    const edgeCount = raw.nodes[nodeRawIndex + nodeEdgeCountOffset] ?? 0;
    for (let i = 0; i < edgeCount; i++) {
      const edgeRawIndex = edgeCursor * edgeFieldCount;
      const typeIndex = raw.edges[edgeRawIndex + edgeTypeOffset] ?? -1;
      const nameOrIndex = raw.edges[edgeRawIndex + edgeNameOffset] ?? -1;
      const toNodeRawIndex = raw.edges[edgeRawIndex + edgeToNodeOffset] ?? -1;
      const to = Math.floor(toNodeRawIndex / nodeFieldCount);
      const target = nodes[to];
      if (!target) {
        warnings.push(`edge from node ${nodeIndex} points outside node table`);
        edgeCursor++;
        continue;
      }
      const type = edgeTypeNames[typeIndex] ?? String(typeIndex);
      const name =
        type === 'element' || type === 'hidden'
          ? String(nameOrIndex)
          : (raw.strings[nameOrIndex] ?? String(nameOrIndex));
      const edge: HeapSnapshotEdge = { type, name, from: nodeIndex, to };
      nodes[nodeIndex]?.outgoing.push(edge);
      if (type !== WEAK_EDGE_TYPE) target.incomingStrong.push(edge);
      edgeCursor++;
    }
  }

  return { nodes, rootIndex: findRootIndex(nodes), warnings };
}

export function analyzeHeapSnapshotGrowth(
  start: ParsedHeapSnapshot,
  end: ParsedHeapSnapshot,
  options: Pick<
    NormalizedHeapSnapshotAnalysisOptions,
    'maxGroups' | 'maxPathsPerGroup' | 'maxRetainerDepth'
  >,
): Omit<HeapSnapshotAnalysisReport, 'available' | 'mode' | 'start' | 'end' | 'warnings'> & {
  warnings: string[];
} {
  computeRetainedSizes(start);
  computeRetainedSizes(end);
  const startGroups = groupByConstructor(start.nodes);
  const endGroups = groupByConstructor(end.nodes);
  const names = new Set([...startGroups.keys(), ...endGroups.keys()]);
  const growthByConstructor: HeapSnapshotGrowthEntry[] = [];

  for (const name of names) {
    const before = startGroups.get(name) ?? emptyGroup(name);
    const after = endGroups.get(name) ?? emptyGroup(name);
    const entry: HeapSnapshotGrowthEntry = {
      name,
      countDelta: after.count - before.count,
      selfSizeDeltaBytes: after.selfSize - before.selfSize,
      retainedSizeDeltaBytes: after.retainedSize - before.retainedSize,
    };
    if (entry.countDelta > 0 || entry.selfSizeDeltaBytes > 0 || entry.retainedSizeDeltaBytes > 0) {
      growthByConstructor.push(entry);
    }
  }

  growthByConstructor.sort(
    (a, b) =>
      b.retainedSizeDeltaBytes - a.retainedSizeDeltaBytes ||
      b.selfSizeDeltaBytes - a.selfSizeDeltaBytes ||
      b.countDelta - a.countDelta ||
      a.name.localeCompare(b.name),
  );
  const topGroups = growthByConstructor.slice(0, options.maxGroups);
  const retainerPaths: HeapSnapshotRetainerPath[] = [];

  for (const group of topGroups) {
    const candidates = end.nodes
      .filter((node) => constructorName(node) === group.name)
      .sort((a, b) => b.retainedSize - a.retainedSize || b.selfSize - a.selfSize)
      .slice(0, options.maxPathsPerGroup);
    for (const node of candidates) {
      const path = readableRetainerPath(end, node.index, options.maxRetainerDepth);
      const classified = classifyRetainerPath(path);
      retainerPaths.push({
        constructorName: group.name,
        retainedBytes: node.retainedSize,
        path,
        suspectedPattern: classified.suspectedPattern,
        confidence: classified.confidence,
      });
    }
  }

  const warnings = [...start.warnings, ...end.warnings];
  if (growthByConstructor.length > options.maxGroups) {
    warnings.push(
      `heap snapshot analysis truncated to top ${options.maxGroups} constructor groups`,
    );
  }
  const totalRetainedGrowthBytes = growthByConstructor.reduce(
    (sum, entry) => sum + Math.max(0, entry.retainedSizeDeltaBytes),
    0,
  );
  return {
    summary: {
      totalRetainedGrowthBytes,
      ...(topGroups[0] ? { topGrowingConstructor: topGroups[0].name } : {}),
    },
    growthByConstructor: topGroups,
    retainerPaths,
    warnings,
  };
}

export function buildHeapSnapshotAnalysisReport(
  captured: CapturedHeapSnapshots,
  options: NormalizedHeapSnapshotAnalysisOptions,
): HeapSnapshotAnalysisReport {
  if (!captured.available) {
    return emptyHeapSnapshotAnalysisReport(
      captured.start.path,
      captured.end.path,
      captured.warnings,
    );
  }
  try {
    const start = parseHeapSnapshot(JSON.parse(readFileSync(captured.start.path, 'utf8')));
    const end = parseHeapSnapshot(JSON.parse(readFileSync(captured.end.path, 'utf8')));
    const analysis = analyzeHeapSnapshotGrowth(start, end, options);
    return {
      available: true,
      mode: 'start-end',
      start: captured.start,
      end: captured.end,
      summary: analysis.summary,
      growthByConstructor: analysis.growthByConstructor,
      retainerPaths: analysis.retainerPaths,
      warnings: [...captured.warnings, ...analysis.warnings],
    };
  } catch (error) {
    return emptyHeapSnapshotAnalysisReport(captured.start.path, captured.end.path, [
      ...captured.warnings,
      `heap snapshot analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

export function emptyHeapSnapshotAnalysisReport(
  startPath: string,
  endPath: string,
  warnings: string[] = [],
): HeapSnapshotAnalysisReport {
  return {
    available: false,
    mode: 'start-end',
    start: { path: startPath },
    end: { path: endPath },
    summary: { totalRetainedGrowthBytes: 0 },
    growthByConstructor: [],
    retainerPaths: [],
    warnings,
  };
}

export function classifyRetainerPath(path: string[]): {
  suspectedPattern: HeapSnapshotSuspectedPattern;
  confidence: 'low' | 'medium' | 'high';
} {
  const text = path.join(' ').toLowerCase();
  if (/_events|eventemitter|oncewrapper|listener/.test(text)) {
    return { suspectedPattern: 'event-listener', confidence: 'high' };
  }
  if (/timerslist|timeout|_ontimeout|timer/.test(text)) {
    return { suspectedPattern: 'timer', confidence: 'high' };
  }
  if (/\bmap\b|\bset\b|weakmap|cache|memo|store|entries/.test(text)) {
    return { suspectedPattern: 'cache', confidence: text.includes('weakmap') ? 'low' : 'medium' };
  }
  if (/closure|context|captured/.test(text)) {
    return { suspectedPattern: 'closure', confidence: 'medium' };
  }
  return { suspectedPattern: 'unknown', confidence: 'low' };
}

export function resolveHeapSnapshotPath(outputDir: string, label: 'start' | 'end'): string {
  return join(outputDir, `lanterna-${process.pid}-${Date.now()}-${label}.heapsnapshot`);
}

export async function takeHeapSnapshotToFile(
  cdp: CdpClient,
  path: string,
  options: { abortSignal?: AbortSignal } = {},
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await cdp.send('HeapProfiler.enable');
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(path, { encoding: 'utf8' });
    let settled = false;
    const offChunk = cdp.on('HeapProfiler.addHeapSnapshotChunk', (params) => {
      const chunk = (params as { chunk?: unknown }).chunk;
      if (typeof chunk === 'string') stream.write(chunk);
    });
    const offClose = cdp.onClose(() => {
      finish(new Error('CDP connection closed while taking heap snapshot'));
    });
    const onAbort = () => {
      finish(new Error('heap snapshot capture aborted'));
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      offChunk();
      offClose();
      options.abortSignal?.removeEventListener('abort', onAbort);
      if (error) {
        stream.destroy();
        reject(error);
      } else {
        stream.end(() => resolve());
      }
    };
    if (options.abortSignal?.aborted) {
      finish(new Error('heap snapshot capture aborted'));
      return;
    }
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });
    stream.on('error', (error) => {
      finish(error);
    });
    cdp
      .send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
      .then(() => {
        finish();
      })
      .catch((error) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function requiredOffset(fields: string[], name: string): number {
  const offset = fields.indexOf(name);
  if (offset < 0) throw new Error(`invalid V8 heap snapshot: missing ${name} field`);
  return offset;
}

function findRootIndex(nodes: HeapSnapshotNode[]): number {
  const syntheticRoot = nodes.find((node) => node.type === 'synthetic');
  return syntheticRoot?.index ?? 0;
}

interface ConstructorGroup {
  name: string;
  count: number;
  selfSize: number;
  retainedSize: number;
}

function emptyGroup(name: string): ConstructorGroup {
  return { name, count: 0, selfSize: 0, retainedSize: 0 };
}

function groupByConstructor(nodes: HeapSnapshotNode[]): Map<string, ConstructorGroup> {
  const groups = new Map<string, ConstructorGroup>();
  for (const node of nodes) {
    if (node.type === 'synthetic' || node.name === '') continue;
    const name = constructorName(node);
    const group = groups.get(name) ?? emptyGroup(name);
    group.count++;
    group.selfSize += node.selfSize;
    group.retainedSize += node.retainedSize || node.selfSize;
    groups.set(name, group);
  }
  return groups;
}

function constructorName(node: HeapSnapshotNode): string {
  return node.name || `(${node.type})`;
}

function computeRetainedSizes(snapshot: ParsedHeapSnapshot): void {
  const reachable = reachableNodes(snapshot);
  const order = dfsOrder(snapshot, reachable);
  const postorderIndex = new Map<number, number>();
  order.forEach((nodeIndex, index) => {
    postorderIndex.set(nodeIndex, index);
  });
  const idom = new Map<number, number>();
  idom.set(snapshot.rootIndex, snapshot.rootIndex);

  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeIndex of order) {
      if (nodeIndex === snapshot.rootIndex) continue;
      const preds = snapshot.nodes[nodeIndex]?.incomingStrong
        .map((edge) => edge.from)
        .filter((from) => reachable.has(from) && idom.has(from));
      if (!preds || preds.length === 0) continue;
      let newIdom = preds[0] as number;
      for (const pred of preds.slice(1)) {
        newIdom = intersectDominators(pred, newIdom, idom, postorderIndex);
      }
      if (idom.get(nodeIndex) !== newIdom) {
        idom.set(nodeIndex, newIdom);
        changed = true;
      }
    }
  }

  for (const node of snapshot.nodes)
    node.retainedSize = reachable.has(node.index) ? node.selfSize : 0;
  for (const nodeIndex of [...order].reverse()) {
    if (nodeIndex === snapshot.rootIndex) continue;
    const parent = idom.get(nodeIndex);
    if (parent === undefined || parent === nodeIndex) continue;
    const parentNode = snapshot.nodes[parent];
    const node = snapshot.nodes[nodeIndex];
    if (parentNode && node) parentNode.retainedSize += node.retainedSize;
  }
}

function reachableNodes(snapshot: ParsedHeapSnapshot): Set<number> {
  const reachable = new Set<number>();
  const queue = [snapshot.rootIndex];
  while (queue.length > 0) {
    const nodeIndex = queue.shift() as number;
    if (reachable.has(nodeIndex)) continue;
    reachable.add(nodeIndex);
    for (const edge of snapshot.nodes[nodeIndex]?.outgoing ?? []) {
      if (edge.type !== WEAK_EDGE_TYPE) queue.push(edge.to);
    }
  }
  return reachable;
}

function dfsOrder(snapshot: ParsedHeapSnapshot, reachable: Set<number>): number[] {
  const seen = new Set<number>();
  const post: number[] = [];
  const visit = (nodeIndex: number) => {
    if (seen.has(nodeIndex) || !reachable.has(nodeIndex)) return;
    seen.add(nodeIndex);
    for (const edge of snapshot.nodes[nodeIndex]?.outgoing ?? []) {
      if (edge.type !== WEAK_EDGE_TYPE) visit(edge.to);
    }
    post.push(nodeIndex);
  };
  visit(snapshot.rootIndex);
  return post.reverse();
}

function intersectDominators(
  a: number,
  b: number,
  idom: Map<number, number>,
  order: Map<number, number>,
): number {
  let fingerA = a;
  let fingerB = b;
  while (fingerA !== fingerB) {
    while ((order.get(fingerA) ?? 0) > (order.get(fingerB) ?? 0)) {
      fingerA = idom.get(fingerA) ?? fingerA;
    }
    while ((order.get(fingerB) ?? 0) > (order.get(fingerA) ?? 0)) {
      fingerB = idom.get(fingerB) ?? fingerB;
    }
  }
  return fingerA;
}

function readableRetainerPath(
  snapshot: ParsedHeapSnapshot,
  targetIndex: number,
  maxDepth: number,
): string[] {
  const queue: Array<{ nodeIndex: number; path: string[] }> = [
    { nodeIndex: targetIndex, path: [snapshot.nodes[targetIndex]?.name ?? String(targetIndex)] },
  ];
  const seen = new Set<number>([targetIndex]);
  while (queue.length > 0) {
    const current = queue.shift() as { nodeIndex: number; path: string[] };
    if (current.nodeIndex === snapshot.rootIndex || current.path.length >= maxDepth + 1) {
      return current.path.reverse();
    }
    const incoming = [...(snapshot.nodes[current.nodeIndex]?.incomingStrong ?? [])].sort(
      compareReadableEdges,
    );
    for (const edge of incoming) {
      if (seen.has(edge.from)) continue;
      seen.add(edge.from);
      const fromNode = snapshot.nodes[edge.from];
      const label = fromNode ? `${fromNode.name}${edge.name ? `.${edge.name}` : ''}` : edge.name;
      queue.push({ nodeIndex: edge.from, path: [...current.path, label] });
    }
  }
  return [snapshot.nodes[targetIndex]?.name ?? String(targetIndex)];
}

function compareReadableEdges(a: HeapSnapshotEdge, b: HeapSnapshotEdge): number {
  return edgeReadabilityRank(a) - edgeReadabilityRank(b) || a.name.localeCompare(b.name);
}

function edgeReadabilityRank(edge: HeapSnapshotEdge): number {
  if (edge.type === 'property' || edge.type === 'context') return 0;
  if (edge.type === 'element') return 1;
  if (edge.type === 'internal') return 2;
  return 3;
}
