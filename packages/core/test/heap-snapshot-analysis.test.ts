import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeHeapSnapshotGrowth,
  buildHeapSnapshotAnalysisReport,
  classifyRetainerPath,
  normalizeHeapSnapshotAnalysisOptions,
  parseHeapSnapshot,
} from '../src/kinds/memory/heap-snapshot-analysis.js';

type NodeType = 'synthetic' | 'object' | 'closure' | 'array';
type EdgeType = 'context' | 'element' | 'property' | 'internal' | 'weak';

interface FixtureNode {
  type: NodeType;
  name: string;
  id: number;
  selfSize: number;
}

interface FixtureEdge {
  from: number;
  type: EdgeType;
  name: string | number;
  to: number;
}

function snapshot(nodes: FixtureNode[], edges: FixtureEdge[]): unknown {
  const strings = new Map<string, number>();
  const stringTable: string[] = [];
  const intern = (value: string): number => {
    const existing = strings.get(value);
    if (existing !== undefined) return existing;
    const index = stringTable.length;
    strings.set(value, index);
    stringTable.push(value);
    return index;
  };

  const nodeTypes = [
    'hidden',
    'array',
    'string',
    'object',
    'code',
    'closure',
    'regexp',
    'number',
    'native',
    'synthetic',
  ];
  const edgeTypes = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'];
  const byId = new Map(nodes.map((node, index) => [node.id, { node, index }]));
  const byFrom = new Map<number, FixtureEdge[]>();
  for (const edge of edges) {
    byFrom.set(edge.from, [...(byFrom.get(edge.from) ?? []), edge]);
  }

  const rawNodes: number[] = [];
  for (const node of nodes) {
    rawNodes.push(
      nodeTypes.indexOf(node.type),
      intern(node.name),
      node.id,
      node.selfSize,
      byFrom.get(node.id)?.length ?? 0,
    );
  }

  const rawEdges: number[] = [];
  for (const node of nodes) {
    for (const edge of byFrom.get(node.id) ?? []) {
      const target = byId.get(edge.to);
      if (!target) throw new Error(`missing target ${edge.to}`);
      rawEdges.push(
        edgeTypes.indexOf(edge.type),
        typeof edge.name === 'number' ? edge.name : intern(edge.name),
        target.index * 5,
      );
    }
  }

  return {
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [nodeTypes],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [edgeTypes],
      },
      node_count: nodes.length,
      edge_count: edges.length,
    },
    nodes: rawNodes,
    edges: rawEdges,
    strings: stringTable,
  };
}

describe('heap snapshot parsing and analysis', () => {
  it('parses V8 nodes and edges, excluding weak reverse edges from retention paths', () => {
    const parsed = parseHeapSnapshot(
      snapshot(
        [
          { type: 'synthetic', name: '(GC roots)', id: 1, selfSize: 0 },
          { type: 'object', name: 'Holder', id: 2, selfSize: 10 },
          { type: 'object', name: 'LeakedThing', id: 3, selfSize: 20 },
          { type: 'object', name: 'WeakOnly', id: 4, selfSize: 30 },
        ],
        [
          { from: 1, type: 'property', name: 'holder', to: 2 },
          { from: 2, type: 'property', name: 'value', to: 3 },
          { from: 1, type: 'weak', name: 'weak', to: 4 },
        ],
      ),
    );

    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.nodes[2]?.name).toBe('LeakedThing');
    expect(parsed.nodes[2]?.incomingStrong.map((edge) => edge.name)).toEqual(['value']);
    expect(parsed.nodes[3]?.incomingStrong).toEqual([]);
  });

  it('detects constructor growth and computes retained deltas with a dominator tree', () => {
    const start = parseHeapSnapshot(
      snapshot(
        [
          { type: 'synthetic', name: '(GC roots)', id: 1, selfSize: 0 },
          { type: 'object', name: 'Map', id: 2, selfSize: 8 },
          { type: 'object', name: 'LeakedThing', id: 3, selfSize: 100 },
        ],
        [
          { from: 1, type: 'property', name: 'cache', to: 2 },
          { from: 2, type: 'internal', name: 'entries', to: 3 },
        ],
      ),
    );
    const end = parseHeapSnapshot(
      snapshot(
        [
          { type: 'synthetic', name: '(GC roots)', id: 1, selfSize: 0 },
          { type: 'object', name: 'Map', id: 2, selfSize: 8 },
          { type: 'object', name: 'LeakedThing', id: 3, selfSize: 100 },
          { type: 'object', name: 'LeakedThing', id: 4, selfSize: 100 },
          { type: 'array', name: '(object elements)', id: 5, selfSize: 50 },
        ],
        [
          { from: 1, type: 'property', name: 'cache', to: 2 },
          { from: 2, type: 'internal', name: 'entries', to: 3 },
          { from: 2, type: 'internal', name: 'entries', to: 4 },
          { from: 4, type: 'property', name: 'payload', to: 5 },
        ],
      ),
    );

    const analysis = analyzeHeapSnapshotGrowth(start, end, {
      maxGroups: 5,
      maxPathsPerGroup: 2,
      maxRetainerDepth: 6,
    });

    expect(analysis.summary.topGrowingConstructor).toBe('LeakedThing');
    expect(analysis.growthByConstructor[0]).toMatchObject({
      name: 'LeakedThing',
      countDelta: 1,
      selfSizeDeltaBytes: 100,
      retainedSizeDeltaBytes: 150,
    });
    expect(analysis.retainerPaths[0]).toMatchObject({
      constructorName: 'LeakedThing',
      suspectedPattern: 'cache',
    });
  });

  it('does not report weak-only unreachable objects as retained growth', () => {
    const start = parseHeapSnapshot(
      snapshot([{ type: 'synthetic', name: '(GC roots)', id: 1, selfSize: 0 }], []),
    );
    const end = parseHeapSnapshot(
      snapshot(
        [
          { type: 'synthetic', name: '(GC roots)', id: 1, selfSize: 0 },
          { type: 'object', name: 'WeakOnly', id: 2, selfSize: 4096 },
        ],
        [{ from: 1, type: 'weak', name: 'weak', to: 2 }],
      ),
    );

    const analysis = analyzeHeapSnapshotGrowth(start, end, {
      maxGroups: 5,
      maxPathsPerGroup: 2,
      maxRetainerDepth: 6,
    });

    expect(analysis.growthByConstructor.some((entry) => entry.name === 'WeakOnly')).toBe(false);
    expect(analysis.summary.totalRetainedGrowthBytes).toBe(0);
  });

  it('degrades snapshot analysis instead of reading files above the configured size limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lanterna-heap-test-'));
    try {
      const startPath = join(dir, 'start.heapsnapshot');
      const endPath = join(dir, 'end.heapsnapshot');
      await writeFile(startPath, '{}');
      await writeFile(endPath, '{}');

      const report = buildHeapSnapshotAnalysisReport(
        {
          available: true,
          mode: 'start-end',
          start: { path: startPath },
          end: { path: endPath },
          warnings: [],
        },
        normalizeHeapSnapshotAnalysisOptions({ enabled: true, maxSnapshotBytes: 1 }),
      );

      expect(report.available).toBe(false);
      expect(report.warnings[0]).toMatch(/above the 1 byte analysis limit/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('classifies listener, timer, cache and closure retainer paths', () => {
    expect(
      classifyRetainerPath([
        '(GC roots)',
        'EventEmitter',
        '_events',
        'listener',
        'closure onMessage',
        'context',
      ]).suspectedPattern,
    ).toBe('event-listener');
    expect(
      classifyRetainerPath(['(GC roots)', 'TimersList', 'Timeout', '_onTimeout', 'closure tick'])
        .suspectedPattern,
    ).toBe('timer');
    expect(
      classifyRetainerPath(['(GC roots)', 'Map', 'entries', 'LeakedThing']).suspectedPattern,
    ).toBe('cache');
    expect(
      classifyRetainerPath(['(GC roots)', 'closure build', 'context', 'LeakedThing'])
        .suspectedPattern,
    ).toBe('closure');
  });
});
