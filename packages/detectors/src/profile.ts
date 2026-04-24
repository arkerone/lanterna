import {
  type AnalysisPipeline,
  AttachSource,
  buildLanternaReport,
  type CaptureBundle,
  createCpuProfileKind,
  createManualStopSignal,
  type FindingAnalyzer,
  type LanternaReport,
  type ProfileKind,
  runCapture,
  type SectionAnalyzer,
  SpawnSource,
  sleep,
} from '@lanterna-profiler/core';
import { createBuiltInFindingAnalyzers } from './detectors/index.js';
import type { Detector } from './detectors/types.js';
import type { LanternaDetectorPlugin, LanternaPluginContext } from './plugin.js';
import { createFindingAnalyzerFromDetector } from './plugin.js';

export interface RunProfileOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep: boolean;
  sampleIntervalMicros: number;
  /** Profile kinds to capture. Defaults to `[cpu]`. */
  kinds?: ProfileKind[];
  detectors?: Detector[];
  analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
  setupPipeline?: LanternaDetectorPlugin;
  onTargetDiagnosticChunk?: (chunk: string) => void;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  promptForTarget?: boolean;
  durationMs?: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros: number;
  kinds?: ProfileKind[];
  detectors?: Detector[];
  analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
  setupPipeline?: LanternaDetectorPlugin;
}

export type AttachProgressEvent =
  | { stage: 'resolve-target'; message: string }
  | { stage: 'inspector-ready'; message: string }
  | { stage: 'connect-cdp'; message: string }
  | { stage: 'install-hooks'; message: string }
  | { stage: 'start-capture'; message: string }
  | { stage: 'capture-running'; message: string }
  | { stage: 'finalize-capture'; message: string };

export type RunProgressEvent =
  | { stage: 'spawn-target'; message: string }
  | { stage: 'wait-inspector'; message: string }
  | { stage: 'connect-cdp'; message: string }
  | { stage: 'prepare-runtime'; message: string }
  | { stage: 'start-capture'; message: string }
  | { stage: 'capture-running'; message: string }
  | { stage: 'finalize-capture'; message: string };

export async function runProfile(
  options: RunProfileOptions,
  onProgress?: (event: RunProgressEvent) => void,
): Promise<LanternaReport> {
  let targetDiagnosticBuffer = '';
  const captureTargetDiagnostic = (chunk: string) => {
    targetDiagnosticBuffer += chunk;
    options.onTargetDiagnosticChunk?.(chunk);
  };
  const defaultCpuKind = createCpuProfileKind({
    readStderrSoFar: () => targetDiagnosticBuffer,
  });
  const kinds = options.kinds ?? [defaultCpuKind];

  const manualStop = createManualStopSignal();
  const signalHandlers = bindStopSignals(manualStop.trigger);

  try {
    const bundle = await runCapture({
      source: new SpawnSource(),
      sourceOptions: {
        command: options.command,
        sampleIntervalMicros: options.sampleIntervalMicros,
        deep: options.deep,
        onStdoutChunk: captureTargetDiagnostic,
        onStderrChunk: captureTargetDiagnostic,
        onProgress,
      },
      kinds,
      probeOptions: {
        sampleIntervalMicros: options.sampleIntervalMicros,
        deep: options.deep,
      },
      durationMs: options.durationMs,
      stopSignal: manualStop.promise,
    });

    onProgress?.({
      stage: 'finalize-capture',
      message: 'Stopping the profiler and collecting the final samples...',
    });

    return await analyzeAndBuild(bundle, options, kinds, 'spawn');
  } finally {
    signalHandlers.dispose();
  }
}

export async function attachProfile(
  options: AttachProfileOptions,
  onProgress?: (event: AttachProgressEvent) => void,
): Promise<LanternaReport> {
  const defaultCpuKind = createCpuProfileKind({ readStderrSoFar: () => '' });
  const kinds = options.kinds ?? [defaultCpuKind];

  const manualStop = createManualStopSignal();
  const signalHandlers = bindStopSignals(manualStop.trigger);

  try {
    const bundle = await runCapture({
      source: new AttachSource(),
      sourceOptions: {
        pid: options.pid,
        inspectUrl: options.inspectUrl,
        sampleIntervalMicros: options.sampleIntervalMicros,
        onProgress,
      },
      kinds,
      probeOptions: {
        sampleIntervalMicros: options.sampleIntervalMicros,
        deep: false,
      },
      durationMs: options.durationMs,
      stopSignal: manualStop.promise,
    });

    onProgress?.({
      stage: 'finalize-capture',
      message: 'Stopping the profiler and collecting the final samples...',
    });

    return await analyzeAndBuild(bundle, options, kinds, 'attach');
  } finally {
    signalHandlers.dispose();
  }
}

async function analyzeAndBuild(
  bundle: CaptureBundle,
  options: {
    sampleIntervalMicros: number;
    deep?: boolean;
    detectors?: Detector[];
    analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
    setupPipeline?: LanternaDetectorPlugin;
    command?: string[];
  },
  kinds: ProfileKind[],
  mode: 'spawn' | 'attach',
): Promise<LanternaReport> {
  const analysisOptions = {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: Boolean(options.deep),
    command: options.command ?? [],
    mode: mode as 'spawn' | 'attach',
  };
  const pipeline = await buildInjectedPipeline(options, kinds, mode);
  const analysis = pipeline.run(bundle, analysisOptions);
  return buildLanternaReport(
    bundle,
    analysis,
    kinds.map((k) => k.id),
    analysisOptions,
  );
}

async function buildInjectedPipeline(
  options: {
    detectors?: Detector[];
    analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
    setupPipeline?: LanternaDetectorPlugin;
  },
  kinds: ProfileKind[],
  mode: 'spawn' | 'attach',
): Promise<AnalysisPipeline> {
  const { createAnalysisPipeline } = await import('@lanterna-profiler/core');
  const pipeline = createAnalysisPipeline({
    kinds,
    findingAnalyzers: createBuiltInFindingAnalyzers(),
  });
  if (options.detectors) {
    for (const detector of options.detectors) {
      pipeline.register(createFindingAnalyzerFromDetector(detector));
    }
  }
  if (options.analyzers) {
    for (const analyzer of options.analyzers) {
      pipeline.register(analyzer);
    }
  }
  if (options.setupPipeline) {
    const ctx: LanternaPluginContext = { cwd: process.cwd(), mode };
    await options.setupPipeline(pipeline, ctx);
  }
  return pipeline;
}

function bindStopSignals(trigger: () => void): { dispose: () => void } {
  const listener = () => trigger();
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) process.on(signal, listener);
  return {
    dispose: () => {
      for (const signal of signals) process.off(signal, listener);
    },
  };
}

// Silence unused import warning (kept for type access above).
void sleep;
