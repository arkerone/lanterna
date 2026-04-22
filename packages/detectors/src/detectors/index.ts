import type { FindingAnalyzer } from '@lanterna-profiler/core';
import { createFindingAnalyzerFromDetector } from '../plugin.js';
import { blockingIoDetector } from './blocking-io.js';
import { deoptLoopDetector } from './deopt-loop.js';
import { eventLoopStallDetector } from './event-loop-stall.js';
import { excessiveGcDetector } from './excessive-gc.js';
import { jsonOnHotPathDetector } from './json-on-hot-path.js';
import { nodeModulesHotspotDetector } from './node-modules-hotspot.js';
import { requireInHotPathDetector } from './require-in-hot-path.js';
import { syncCryptoDetector } from './sync-crypto.js';
import type { Detector } from './types.js';

export const DETECTORS: Detector[] = [
  syncCryptoDetector,
  blockingIoDetector,
  jsonOnHotPathDetector,
  excessiveGcDetector,
  eventLoopStallDetector,
  deoptLoopDetector,
  requireInHotPathDetector,
  nodeModulesHotspotDetector,
];

export function createBuiltInFindingAnalyzers(): FindingAnalyzer[] {
  return DETECTORS.map(createFindingAnalyzerFromDetector);
}
