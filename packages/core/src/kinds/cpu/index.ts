import type { CaptureProbe, ProfileKind } from '../core/types.js';
import { defineProfileKind } from '../core/types.js';
import { cpuFinalize, createCpuAnalysisContributor } from './analysis.js';
import { type CpuKindData, createCpuProbe } from './probe.js';

declare module '../core/types.js' {
  interface CaptureKindDataMap {
    cpu: CpuKindData;
  }
}

/**
 * The CPU profile kind. Drives `Profiler.start`/`stop` over CDP, optionally
 * parses `--trace-deopt` output, and contributes the `profiles.cpu.*` section
 * of the Lanterna report (summary, hotspots, hotStacks, gc, eventLoop, deopts).
 */
export interface CpuKindOptions {
  /** Supplies the stderr buffer so `deep` mode can parse deopt traces. */
  readStderrSoFar(): string;
  /** Callback invoked after CPU stop with whether samples carried timestamps. */
  onCpuSamplesTimed?(hasTimedSamples: boolean): void;
}

export function createCpuProfileKind(options: CpuKindOptions): ProfileKind<CpuKindData> {
  return defineProfileKind<CpuKindData>({
    id: 'cpu',
    label: 'CPU',
    reportSectionKey: 'cpu',
    createProbe: (probeOptions): CaptureProbe<CpuKindData> =>
      createCpuProbe(probeOptions, {
        readStderrSoFar: options.readStderrSoFar,
        onCpuSamplesTimed: options.onCpuSamplesTimed,
      }),
    createAnalysisContributor: () => createCpuAnalysisContributor(),
    finalize: cpuFinalize,
  });
}

export type { CpuAnalysisView } from './analysis.js';
export { cpuFinalize, createCpuAnalysisContributor } from './analysis.js';
export type { CpuKindData } from './probe.js';
export { createCpuProbe } from './probe.js';
