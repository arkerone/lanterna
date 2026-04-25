import { AttachSource } from '../capture/attach.js';
import { createManualStopSignal, runCapture } from '../capture/coordinator.js';
import type { CaptureBundle } from '../capture/core/types.js';
import { SpawnSource } from '../capture/spawn.js';
import type { ProfileKind } from '../kinds/core/types.js';
import { createCpuProfileKind } from '../kinds/cpu/index.js';
import { buildLanternaReport } from '../report/index.js';
import type { LanternaReport } from '../report/types.js';
import { configureProfilePipeline } from './pipeline.js';
import type {
  AttachProfileOptions,
  AttachProgressEvent,
  RunProfileOptions,
  RunProgressEvent,
} from './types.js';

export async function runProfile(
  options: RunProfileOptions,
  onProgress?: (event: RunProgressEvent) => void,
): Promise<LanternaReport> {
  let targetDiagnosticBuffer = '';
  const captureTargetDiagnostic = (chunk: string) => {
    targetDiagnosticBuffer += chunk;
    options.onTargetDiagnosticChunk?.(chunk);
  };
  const kinds = options.kinds ?? [
    createCpuProfileKind({
      readStderrSoFar: () => targetDiagnosticBuffer,
      sampleIntervalMicros: options.sampleIntervalMicros,
      deep: options.deep,
    }),
  ];

  const manualStop = createManualStopSignal();
  const signalHandlers = bindStopSignals(manualStop.trigger);

  try {
    const bundle = await runCapture({
      source: new SpawnSource(),
      sourceOptions: {
        command: options.command,
        traceDeopt: options.deep,
        onStdoutChunk: captureTargetDiagnostic,
        onStderrChunk: captureTargetDiagnostic,
        onProgress,
      },
      kinds,
      durationMs: options.durationMs,
      stopSignal: manualStop.promise,
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
  const kinds = options.kinds ?? [
    createCpuProfileKind({
      readStderrSoFar: () => '',
      sampleIntervalMicros: options.sampleIntervalMicros,
    }),
  ];

  const manualStop = createManualStopSignal();
  const signalHandlers = bindStopSignals(manualStop.trigger);

  try {
    const bundle = await runCapture({
      source: new AttachSource(),
      sourceOptions: {
        pid: options.pid,
        inspectUrl: options.inspectUrl,
        onProgress,
      },
      kinds,
      durationMs: options.durationMs,
      stopSignal: manualStop.promise,
    });

    return await analyzeAndBuild(bundle, options, kinds, 'attach');
  } finally {
    signalHandlers.dispose();
  }
}

async function analyzeAndBuild(
  bundle: CaptureBundle,
  options: {
    extraAnalyzers?: RunProfileOptions['extraAnalyzers'];
    setupPipeline?: RunProfileOptions['setupPipeline'];
    command?: string[];
  },
  kinds: ProfileKind[],
  mode: 'spawn' | 'attach',
) {
  const analysisOptions = {
    command: options.command ?? [],
    mode,
  };
  const builtIn = kinds.flatMap((kind) => kind.builtInAnalyzers ?? []);
  const analyzers = [...builtIn, ...(options.extraAnalyzers ?? [])];
  const pipeline = await configureProfilePipeline(
    {
      kinds,
      analyzers,
      setupPipeline: options.setupPipeline,
    },
    mode,
  );
  const analysis = pipeline.run(bundle, analysisOptions);
  return buildLanternaReport(bundle, analysis, kinds, analysisOptions);
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
