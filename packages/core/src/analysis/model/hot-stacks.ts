import type { RawCpuProfile } from '../../capture/core/types.js';
import type { HotStack, HotStackCluster } from '../../report/types.js';
import { isNoiseCategory, shouldKeepNoiseFrames } from '../noise-filters.js';
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

  const keepNoise = shouldKeepNoiseFrames();
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
        if (!isNoiseCategory(node.category) || keepNoise) {
          const frame: HotStack['frames'][number] = {
            function: node.function,
            file: node.file,
            line: node.line,
            category: node.category,
          };
          if (node.source) frame.source = node.source;
          frames.push(frame);
        }
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

/**
 * Group hot stacks by their top-most user-code anchor so callers can reason
 * about "the feature driving this cost" rather than treating superficially-
 * different stacks as independent. Stacks without any user frame are skipped.
 */
export function clusterHotStacksByUserAnchor(stacks: HotStack[]): HotStackCluster[] {
  const clustersByKey = new Map<
    string,
    {
      anchor: HotStackCluster['anchor'];
      weightPct: number;
      memberIndices: number[];
    }
  >();

  for (let index = 0; index < stacks.length; index++) {
    const stack = stacks[index];
    if (!stack) continue;
    const userFrame = stack.frames.find((frame) => frame.category === 'user');
    if (!userFrame) continue;
    const key = `${userFrame.file}|${userFrame.function}|${userFrame.line}`;
    const existing = clustersByKey.get(key);
    if (existing) {
      existing.weightPct += stack.weightPct;
      existing.memberIndices.push(index);
    } else {
      const anchor: HotStackCluster['anchor'] = {
        function: userFrame.function,
        file: userFrame.file,
        line: userFrame.line,
      };
      if (userFrame.source) anchor.source = userFrame.source;
      clustersByKey.set(key, {
        anchor,
        weightPct: stack.weightPct,
        memberIndices: [index],
      });
    }
  }

  return Array.from(clustersByKey.values())
    .filter((cluster) => cluster.memberIndices.length >= 2)
    .map((cluster) => ({
      anchor: cluster.anchor,
      weightPct: cluster.weightPct,
      stackCount: cluster.memberIndices.length,
      memberIndices: cluster.memberIndices,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
}
