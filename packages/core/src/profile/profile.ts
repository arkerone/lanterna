import {
  createNoopSourceMapResolver,
  createSourceMapResolver,
  type SourceMapResolver,
} from '../analysis/sourcemap/resolver.js';
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
  const signalHandlers = bindStopSignals(manualStop.trigger, () => {
    const message = manualStopMessage(kinds);
    if (!message) return;
    onProgress?.({
      stage: 'finalize-capture',
      message,
    });
  });

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
      abortSignal: manualStop.abortSignal,
      beforeCaptureStart: options.beforeCaptureStart,
      onCaptureStarted: options.onCaptureStarted,
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
  const signalHandlers = bindStopSignals(manualStop.trigger, () => {
    const message = manualStopMessage(kinds);
    if (!message) return;
    onProgress?.({
      stage: 'finalize-capture',
      message,
    });
  });

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
      abortSignal: manualStop.abortSignal,
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
    sourceMaps?: boolean;
  },
  kinds: ProfileKind[],
  mode: 'spawn' | 'attach',
) {
  const sourceMaps: SourceMapResolver =
    options.sourceMaps === false
      ? createNoopSourceMapResolver()
      : createSourceMapResolver({ cwd: bundle.target.cwd, enabled: true });
  const analysisOptions = {
    command: options.command ?? [],
    mode,
    sourceMaps,
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
  const report = buildLanternaReport(bundle, analysis, kinds, analysisOptions);
  const integrity = sourceMaps.integrity();
  if (integrity.enabled && report.meta?.captureIntegrity) {
    report.meta.captureIntegrity.sourceMaps = integrity;
  }
  return report;
}

function bindStopSignals(trigger: () => void, onSignal?: () => void): { dispose: () => void } {
  const listener = () => {
    onSignal?.();
    trigger();
  };
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) process.on(signal, listener);
  return {
    dispose: () => {
      for (const signal of signals) process.off(signal, listener);
    },
  };
}

function manualStopMessage(kinds: ProfileKind[]): string | undefined {
  return kinds.find((kind) => kind.manualStopMessage)?.manualStopMessage;
}
