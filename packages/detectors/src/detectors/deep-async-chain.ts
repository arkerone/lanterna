import type { BaseFinding, Finding, KindScopedDetector } from '@lanterna-profiler/core';
import { DETECTOR_THRESHOLDS } from '../config.js';
import {
  anchorForFile,
  asyncConfidence,
  asyncEvidenceExtra,
  resolveAsyncUserCaller,
} from './async-evidence.js';

/**
 * Fires when an async trigger chain reaches deep into the tree. Deep chains
 * usually mean accidental recursion through promises, callback hell, or a
 * stream piped through too many transformers — all hard to debug from a
 * synchronous stack.
 */
export const deepAsyncChainDetector: KindScopedDetector<'async'> = {
  id: 'deep-async-chain',
  kindIds: ['async'],
  detect({ async }): Finding[] {
    const thresholds = DETECTOR_THRESHOLDS.deepAsyncChain;
    const report = async.report;
    if (!report.summary.available) return [];

    const dropped = report.summary.recordsDropped > 0;
    const findings: Finding[] = [];
    for (const chain of report.chains) {
      if (findings.length >= thresholds.maxFindings) break;
      if (chain.depth < thresholds.minDepth) continue;
      if (isTimerOnlySyntheticChain(chain)) continue;
      const severity: BaseFinding['severity'] =
        chain.depth >= thresholds.criticalDepth ? 'critical' : 'warning';
      const rootFrame = chain.rootFrame;
      const anchor = anchorForFile(report, chain.dominantFile ?? rootFrame?.file);
      const frame = anchor.frame ?? rootFrame;
      const userCaller = resolveAsyncUserCaller(undefined, frame, {
        confidence: 'high',
        basis: 'async-stack',
      });
      findings.push({
        id: `deep-async-chain:${chain.rootAsyncId}`,
        profileKind: 'async',
        severity,
        category: 'deep-async-chain',
        title: frame
          ? `Async chain ${chain.depth} levels deep from \`${frame.function}\``
          : `Async chain ${chain.depth} levels deep (root: ${chain.rootKind})`,
        confidence: dropped ? 'low' : asyncConfidence(report, 'high'),
        proofLevel: 'direct-sample',
        evidence: {
          file: frame?.file ?? '(async)',
          line: frame?.line ?? 0,
          function: frame?.function ?? `chain:${chain.rootKind}#${chain.rootAsyncId}`,
          selfPct: 0,
          ...(frame?.source ? { source: frame.source } : {}),
          extra: {
            rootAsyncId: chain.rootAsyncId,
            rootKind: chain.rootKind,
            rootFrame: rootFrame ?? null,
            deepestFrame: chain.deepestFrame ?? null,
            dominantFile: chain.dominantFile ?? null,
            depth: chain.depth,
            totalOperations: chain.totalOperations,
            totalDurationMs: chain.totalDurationMs,
            deepestPath: chain.deepestPath,
            ...(userCaller ? { userCaller } : {}),
            ...asyncEvidenceExtra(report, anchor),
          },
        },
        measurements: {
          observed: {
            depth: chain.depth,
            totalOperations: chain.totalOperations,
          },
          thresholds: {
            minDepth: thresholds.minDepth,
            criticalDepth: thresholds.criticalDepth,
          },
        },
        why: `An async chain rooted in a \`${chain.rootKind}\` resource grew ${chain.depth} levels deep, spanning ${chain.totalOperations} resources. Deep chains accumulate latency and make exception traces harder to read; they're usually a sign of recursion-through-promises or a stream pipeline with too many awaits in series.`,
        suggestion: `Walk the deepest path (${chain.deepestPath.slice(0, 8).join(' → ')}${chain.deepestPath.length > 8 ? ' → …' : ''}) to find redundant awaits. Run independent operations with \`Promise.all\` instead of sequential \`await\`s, and convert recursive promise chains into iterative loops.`,
        references: ['https://nodejs.org/api/async_hooks.html'],
      });
    }
    return findings;
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
