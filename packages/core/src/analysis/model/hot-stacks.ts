import type { RawCpuProfile } from '../../capture/core/types.js';
import type { HotStack } from '../../report/types.js';
import type { EnrichedTree } from './hotspots.js';

export function computeHotStacks(
  profile: RawCpuProfile,
  tree: EnrichedTree,
  topN = 10,
): HotStack[] {
  const samples = profile.samples ?? [];
  if (samples.length === 0) {
    // Fallback: walk nodes weighted by hitCount, no call chain
    return [];
  }

  // Count samples per leaf node; then for each leaf build its stack path to root
  const sampleCountByLeafId = new Map<number, number>();
  for (const leafId of samples) {
    sampleCountByLeafId.set(leafId, (sampleCountByLeafId.get(leafId) ?? 0) + 1);
  }

  const total = samples.length;
  const entries = Array.from(sampleCountByLeafId.entries()).sort((a, b) => b[1] - a[1]);

  const stacks: HotStack[] = [];
  for (const [leafId, count] of entries) {
    if (stacks.length >= topN) break;
    const frames: HotStack['frames'] = [];
    let currentNodeId: number | undefined = leafId;
    const visitedNodeIds = new Set<number>();
    while (currentNodeId !== undefined && !visitedNodeIds.has(currentNodeId)) {
      visitedNodeIds.add(currentNodeId);
      const node = tree.nodes.get(currentNodeId);
      if (!node) break;
      if (node.function !== '(root)') {
        frames.push({
          function: node.function,
          file: node.file,
          line: node.line,
          category: node.category,
        });
      }
      currentNodeId = tree.parentOf.get(currentNodeId);
    }
    if (frames.length === 0) continue;
    stacks.push({
      weightPct: (count / total) * 100,
      frames, // leaf → root order
    });
  }
  return stacks;
}
