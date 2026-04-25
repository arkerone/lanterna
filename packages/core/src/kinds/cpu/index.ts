import { cpuProfileReportSchema } from '../../report/schema/cpu-profile.js';
import { DEFAULT_SAMPLE_INTERVAL_MICROS } from '../../shared/config.js';
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
  /** V8 sampling interval in microseconds. Defaults to 1000us. */
  sampleIntervalMicros?: number;
  /** Whether to parse `--trace-deopt` traces from stderr. Defaults to false. */
  deep?: boolean;
}

export function createCpuProfileKind(options: CpuKindOptions): ProfileKind<CpuKindData> {
  const sampleIntervalMicros = options.sampleIntervalMicros ?? DEFAULT_SAMPLE_INTERVAL_MICROS;
  const deep = options.deep ?? false;
  return defineProfileKind<CpuKindData>({
    id: 'cpu',
    label: 'CPU',
    reportSectionKey: 'cpu',
    reportSchema: cpuProfileReportSchema,
    createProbe: (): CaptureProbe<CpuKindData> =>
      createCpuProbe({
        sampleIntervalMicros,
        deep,
        readStderrSoFar: options.readStderrSoFar,
      }),
    createAnalysisContributor: () => createCpuAnalysisContributor({ sampleIntervalMicros }),
    finalize: cpuFinalize,
    contributeMeta: (data) => ({
      samplesTotal: countCpuSamples(data),
      sampleIntervalMicros,
      deep,
    }),
    contributeIntegrity: (data) => ({
      samplesTimed: data.samplesTimed,
    }),
  });
}

function countCpuSamples(data: CpuKindData): number {
  return data.cpuProfile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
}

export type { CpuAnalysisView } from './analysis.js';
export { cpuFinalize, createCpuAnalysisContributor } from './analysis.js';
export type { CpuKindData } from './probe.js';
export { createCpuProbe } from './probe.js';
