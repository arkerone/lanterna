import { startCpuMeasure, stopCpuMeasure } from '../../capture/core/cpu.js';
import { parseDeoptsFromStderr } from '../../capture/core/deopts.js';
import type { CaptureIntegrity, RawCpuProfile, RawDeopt } from '../../capture/core/types.js';
import type { CdpClient } from '../../inspector/client.js';
import type { CaptureProbe, KindProbeOptions } from '../core/types.js';

export interface CpuKindData {
  cpuProfile: RawCpuProfile;
  deopts: RawDeopt[];
}

export interface CpuProbeDependencies {
  /** Accumulates stderr from the target — used when `deep` is true. */
  readStderrSoFar(): string;
  /**
   * Reports whether the CDP CPU profile contained timestamped samples. Allows
   * the coordinator to update `captureIntegrity.cpuSamplesTimed`.
   */
  onCpuSamplesTimed?(hasTimedSamples: boolean): void;
}

/**
 * Builds the CPU capture probe: starts `Profiler.start`, stops it on capture
 * end, and optionally parses `--trace-deopt` output from stderr when `deep`.
 */
export function createCpuProbe(
  options: KindProbeOptions,
  deps: CpuProbeDependencies,
): CaptureProbe<CpuKindData> {
  return {
    async start(cdp: CdpClient) {
      await startCpuMeasure(cdp, options.sampleIntervalMicros);
    },
    async stop(cdp: CdpClient): Promise<CpuKindData> {
      const cpuProfile = await stopCpuMeasure(cdp);
      deps.onCpuSamplesTimed?.(hasTimedCpuSamples(cpuProfile));
      const deopts = options.deep ? parseDeoptsFromStderr(deps.readStderrSoFar()) : [];
      return { cpuProfile, deopts };
    },
  };
}

function hasTimedCpuSamples(cpuProfile: RawCpuProfile): boolean {
  const samples = cpuProfile.samples;
  const deltas = cpuProfile.timeDeltas;
  if (!samples || samples.length === 0) return false;
  if (!deltas || deltas.length !== samples.length) return false;
  return true;
}

// Re-export as type-bearer
export type { CaptureIntegrity };
