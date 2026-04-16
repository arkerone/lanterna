import type { RawCapture } from '../../capture/core/types.js';
import { buildTimedSamples } from '../model/correlations.js';
import { aggregateHotspots, enrichCpuTree } from '../model/hotspots.js';
import type { AnalysisContext, AnalysisOptions } from './types.js';

export function createAnalysisContext(
  rawCapture: RawCapture,
  options: AnalysisOptions,
): AnalysisContext {
  let cachedTree: ReturnType<typeof enrichCpuTree> | undefined;
  let cachedHotspotAnalysis: ReturnType<typeof aggregateHotspots> | undefined;
  let cachedTimedSamples: ReturnType<typeof buildTimedSamples> | undefined;

  return {
    rawCapture,
    options,
    getTree() {
      cachedTree ??= enrichCpuTree(
        rawCapture.cpuProfile,
        rawCapture.target.cwd,
        options.sampleIntervalMicros,
      );
      return cachedTree;
    },
    getHotspotAnalysis() {
      cachedHotspotAnalysis ??= aggregateHotspots(rawCapture.cpuProfile, this.getTree());
      return cachedHotspotAnalysis;
    },
    getTimedSamples() {
      cachedTimedSamples ??= buildTimedSamples(rawCapture, options.sampleIntervalMicros);
      return cachedTimedSamples;
    },
  };
}
