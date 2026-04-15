import type { Finding, LanternaReport } from '../../report/types.js';
import { syncCryptoDetector } from './sync-crypto.js';
import { blockingIoDetector } from './blocking-io.js';
import { excessiveGcDetector } from './excessive-gc.js';
import { eventLoopStallDetector } from './event-loop-stall.js';
import { deoptLoopDetector } from './deopt-loop.js';
import { requireInHotPathDetector } from './require-in-hot-path.js';
import type { Detector, FindingContext } from './types.js';

export const DETECTORS: Detector[] = [
  syncCryptoDetector,
  blockingIoDetector,
  excessiveGcDetector,
  eventLoopStallDetector,
  deoptLoopDetector,
  requireInHotPathDetector,
];

export function runFindings(report: LanternaReport, context: FindingContext): Finding[] {
  const all: Finding[] = [];
  for (const d of DETECTORS) {
    try {
      all.push(...d.detect(report, context));
    } catch (err) {
      // A detector must never crash the report
      process.stderr.write(`lanterna: detector ${d.id} failed: ${(err as Error).message}\n`);
    }
  }
  // Sort: critical > warning > info, then by selfPct desc
  const sev = { critical: 3, warning: 2, info: 1 } as const;
  return all.sort((a, b) => {
    const s = sev[b.severity] - sev[a.severity];
    if (s !== 0) return s;
    return b.evidence.selfPct - a.evidence.selfPct;
  });
}
