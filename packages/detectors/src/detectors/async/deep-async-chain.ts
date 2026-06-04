import type { BaseFinding, Finding, KindScopedDetector } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../../config.js';
import { anchorForFile, resolveAsyncUserCaller } from '../shared/async-evidence.js';
import {
  collectAsyncListFindings,
  confidenceForAsyncFinding,
  emitAsyncFinding,
  skipAsyncItem,
} from '../shared/async-finding.js';

/**
 * Fires when an async chain is built by recursion through promises — the same
 * user function appears many times in a resource's creation stack. That's the
 * canonical "deep async chain": accidental recursion-through-promises (e.g.
 * awaiting a self-recursive resolver), hard to debug from a synchronous stack.
 *
 * Crucially it gates on `recursionDepth`, not the structural trigger `depth`.
 * async_hooks cannot encode await-*nesting* as a live chain, and the structural
 * depth is just how many awaits happened in sequence over time — so a long
 * sequential `while { await }` loop (queue consumer, poller) or a `Promise.all`
 * fan-out inflates `depth` to thousands without any recursion, and does not
 * trigger here.
 */
export const deepAsyncChainDetector: KindScopedDetector<'async'> = {
  id: 'deep-async-chain',
  kindIds: ['async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.deepAsyncChain;
    const report = async.report;
    if (!report.summary.available) return [];

    return collectAsyncListFindings(report.chains, thresholds.maxFindings, (chain) => {
      if (chain.recursionDepth < thresholds.minRecursionDepth) return skipAsyncItem;
      if (isTimerOnlySyntheticChain(chain)) return skipAsyncItem;
      const severity: BaseFinding['severity'] =
        chain.recursionDepth >= thresholds.criticalRecursionDepth ? 'critical' : 'warning';
      const rootFrame = chain.rootFrame;
      const anchor = anchorForFile(report, chain.dominantFile ?? rootFrame?.file);
      const frame = anchor.frame ?? rootFrame;
      const userCaller = resolveAsyncUserCaller(undefined, frame, {
        confidence: 'high',
        basis: 'async-stack',
      });
      return emitAsyncFinding({
        report,
        anchor,
        frame,
        fallback: {
          file: '(async)',
          line: 0,
          function: `chain:${chain.rootKind}#${chain.rootAsyncId}`,
        },
        userCaller,
        id: `deep-async-chain:${chain.rootAsyncId}`,
        severity,
        category: 'deep-async-chain',
        title: frame
          ? `Async recursion ${chain.recursionDepth} levels deep through \`${frame.function}\``
          : `Async recursion ${chain.recursionDepth} levels deep (root: ${chain.rootKind})`,
        confidence: confidenceForAsyncFinding(report, { base: 'high' }),
        proofLevel: 'direct-sample',
        extra: {
          rootAsyncId: chain.rootAsyncId,
          rootKind: chain.rootKind,
          rootFrame: rootFrame ?? null,
          deepestFrame: chain.deepestFrame ?? null,
          dominantFile: chain.dominantFile ?? null,
          recursionDepth: chain.recursionDepth,
          triggerChainDepth: chain.depth,
          totalOperations: chain.totalOperations,
          totalDurationMs: chain.totalDurationMs,
          deepestPath: chain.deepestPath,
        },
        measurements: {
          observed: {
            recursionDepth: chain.recursionDepth,
            triggerChainDepth: chain.depth,
            totalOperations: chain.totalOperations,
          },
          thresholds: {
            minRecursionDepth: thresholds.minRecursionDepth,
            criticalRecursionDepth: thresholds.criticalRecursionDepth,
          },
        },
        why: `An async chain rooted in a \`${chain.rootKind}\` resource recurses through promises ${chain.recursionDepth} levels deep — the same user function appears ${chain.recursionDepth}× in a resource's creation stack (structural trigger depth ${chain.depth}, spanning ${chain.totalOperations} resources). Recursion through awaited promises accumulates latency and makes exception traces hard to read. (A long *sequential* await loop or a \`Promise.all\` fan-out would show a high trigger depth but a recursion depth of ~1 and is not flagged.)`,
        suggestion: `Find the recursive \`await\` in \`${frame?.function ?? chain.dominantFile ?? 'the dominant file'}\` and convert the recursion-through-promises into an iterative loop, or batch independent steps with \`Promise.all\` instead of awaiting each level in series.`,
        references: ['https://nodejs.org/api/async_hooks.html'],
      });
    });
  },
};

function isTimerOnlySyntheticChain(chain: {
  deepestPath: readonly string[];
  rootFrame?: unknown;
  deepestFrame?: unknown;
  dominantFile?: string;
}): boolean {
  if (chain.rootFrame || chain.deepestFrame || chain.dominantFile) return false;
  return (
    chain.deepestPath.length > 0 &&
    chain.deepestPath.every((kind) => kind === 'timer' || kind === 'immediate')
  );
}
