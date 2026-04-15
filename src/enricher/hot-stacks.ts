import type { RawCpuProfile } from '../collector/source.js';
import type { HotStack } from '../report/types.js';
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
  const hitCount = new Map<number, number>();
  for (const id of samples) hitCount.set(id, (hitCount.get(id) ?? 0) + 1);

  const total = samples.length;
  const entries = Array.from(hitCount.entries()).sort((a, b) => b[1] - a[1]);

  const stacks: HotStack[] = [];
  for (const [leafId, count] of entries) {
    if (stacks.length >= topN) break;
    const frames: HotStack['frames'] = [];
    let cur: number | undefined = leafId;
    const guard = new Set<number>();
    while (cur !== undefined && !guard.has(cur)) {
      guard.add(cur);
      const n = tree.nodes.get(cur);
      if (!n) break;
      if (n.function !== '(root)') {
        frames.push({
          function: n.function,
          file: n.file,
          line: n.line,
          category: n.category,
        });
      }
      cur = tree.parentOf.get(cur);
    }
    if (frames.length === 0) continue;
    stacks.push({
      weightPct: (count / total) * 100,
      frames, // leaf → root order
    });
  }
  return stacks;
}
