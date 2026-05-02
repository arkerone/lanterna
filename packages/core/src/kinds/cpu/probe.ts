import { startCpuMeasure, stopCpuMeasure } from '../../capture/core/cpu.js';
import { parseDeoptsFromStderr } from '../../capture/core/deopts.js';
import type { CaptureIntegrity, RawCpuProfile, RawDeopt } from '../../capture/core/types.js';
import type { CaptureProbe, ProbeLifecycleContext } from '../core/types.js';

export interface CpuKindData {
  cpuProfile: RawCpuProfile;
  deopts: RawDeopt[];
  /** Whether the raw CPU profile carried per-sample timestamps. */
  samplesTimed: boolean;
}

export interface CpuProbeOptions {
  sampleIntervalMicros: number;
  deep: boolean;
  /** Accumulates stderr from the target — used when `deep` is true. */
  readStderrSoFar(): string;
}

/**
 * Builds the CPU capture probe: starts `Profiler.start`, stops it on capture
 * end, and optionally parses `--trace-deopt` output from stderr when `deep`.
 */
export function createCpuProbe(options: CpuProbeOptions): CaptureProbe<CpuKindData> {
  return {
    async start(ctx: ProbeLifecycleContext) {
      await startCpuMeasure(ctx.cdp, options.sampleIntervalMicros);
    },
    async stop(ctx: ProbeLifecycleContext): Promise<CpuKindData> {
      const cpuProfile = await stopCpuMeasure(ctx.cdp);
      const samplesTimed = hasTimedCpuSamples(cpuProfile);
      const deopts = options.deep ? parseDeoptsFromStderr(options.readStderrSoFar()) : [];
      return { cpuProfile, deopts, samplesTimed };
    },
    async dispose(ctx: ProbeLifecycleContext) {
      if (ctx.cdp.closed) return;
      await ctx.cdp.send('Profiler.disable');
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
