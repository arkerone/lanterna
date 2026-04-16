import {
  type AnalysisPipeline,
  buildLanternaReport,
  type CaptureHandle,
  type FindingAnalyzer,
  type LanternaReport,
  type SectionAnalyzer,
  sleep,
  startAttachCapture,
  startSpawnCapture,
} from '@lanterna/core';
import { createDefaultAnalysisPipeline } from './analyze-capture.js';
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
  detectors?: Detector[];
  analyzers?: (FindingAnalyzer | SectionAnalyzer)[];
  setupPipeline?: LanternaDetectorPlugin;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  promptForTarget?: boolean;
  durationMs?: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros: number;
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

/**
 * Spawns a child process, profiles it, and returns a complete
 * {@link LanternaReport}.
 *
 * High-level facade over `startSpawnCapture` + `AnalysisPipeline.run` +
 * `buildLanternaReport`. Use the `onProgress` callback to stream stage
 * updates to a UI or logger.
 */
export async function runProfile(
  options: RunProfileOptions,
  onProgress?: (event: RunProgressEvent) => void,
): Promise<LanternaReport> {
  const handle = await startSpawnCapture({
    command: options.command,
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
    onProgress,
  });

  onProgress?.({
    stage: 'capture-running',
    message:
      options.durationMs === undefined
        ? 'CPU profiling is running until the child exits...'
        : `CPU profiling is running for ${options.durationMs}ms...`,
  });
  const stopReason = await waitForStopReason(handle, options.durationMs);

  onProgress?.({
    stage: 'finalize-capture',
    message: 'Stopping the profiler and collecting the final samples...',
  });
  const rawCapture = await handle.stop();
  const analysisOptions = {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: options.deep,
    command: options.command,
    mode: 'spawn' as const,
  };
  const pipeline = await buildInjectedPipeline(options, 'spawn');
  const analysis = pipeline.run(rawCapture, analysisOptions);
  const report = buildLanternaReport(rawCapture, analysis, analysisOptions);

  if (stopReason.type === 'signal') {
    process.exitCode = 0;
  }

  return report;
}

/**
 * Attaches to a running Node.js process, profiles it for the given duration
 * (or until it exits), and returns a complete {@link LanternaReport}.
 *
 * High-level facade over `startAttachCapture` + `AnalysisPipeline.run` +
 * `buildLanternaReport`. The target process must already be listening on an
 * inspector port or be reachable via SIGUSR1 (POSIX only).
 */
export async function attachProfile(
  options: AttachProfileOptions,
  onProgress?: (event: AttachProgressEvent) => void,
): Promise<LanternaReport> {
  const handle = await startAttachCapture({
    pid: options.pid,
    inspectUrl: options.inspectUrl,
    sampleIntervalMicros: options.sampleIntervalMicros,
    onProgress,
  });

  onProgress?.({
    stage: 'capture-running',
    message:
      options.durationMs === undefined
        ? 'CPU profiling is running. Stop with Ctrl+C or wait for the process to exit.'
        : `CPU profiling is running for ${options.durationMs}ms...`,
  });

  const stopReason = await waitForStopReason(handle, options.durationMs);

  onProgress?.({
    stage: 'finalize-capture',
    message: 'Stopping the profiler and collecting the final samples...',
  });
  const rawCapture = await handle.stop();
  const analysisOptions = {
    sampleIntervalMicros: options.sampleIntervalMicros,
    deep: false,
    command: [],
    mode: 'attach' as const,
  };
  const pipeline = await buildInjectedPipeline(options, 'attach');
  const analysis = pipeline.run(rawCapture, analysisOptions);
  const report = buildLanternaReport(rawCapture, analysis, analysisOptions);

  if (stopReason.type === 'signal') {
    process.exitCode = 0;
  }

  return report;
}

async function buildInjectedPipeline(
  options: Pick<RunProfileOptions, 'detectors' | 'analyzers' | 'setupPipeline'>,
  mode: 'spawn' | 'attach',
): Promise<AnalysisPipeline> {
  const pipeline = createDefaultAnalysisPipeline();
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

type StopReason =
  | { type: 'signal'; signal: NodeJS.Signals }
  | { type: 'timeout' }
  | { type: 'exit' };

async function waitForStopReason(
  handle: Pick<CaptureHandle, 'waitForExit'>,
  durationMs?: number,
): Promise<StopReason> {
  const manualStop = createManualStopWatcher();
  try {
    const pending = [
      handle.waitForExit().then<StopReason>(() => ({ type: 'exit' })),
      manualStop.promise,
    ];
    if (durationMs !== undefined) {
      pending.push(sleep(durationMs).then<StopReason>(() => ({ type: 'timeout' })));
    }
    return await Promise.race(pending);
  } finally {
    manualStop.dispose();
  }
}

function createManualStopWatcher(): {
  promise: Promise<StopReason>;
  dispose: () => void;
} {
  let resolved = false;
  let resolveStop!: (reason: StopReason) => void;
  const listeners = new Map<NodeJS.Signals, () => void>();
  const promise = new Promise<StopReason>((resolve) => {
    resolveStop = resolve;
  });

  const dispose = () => {
    for (const [signal, listener] of listeners) {
      process.off(signal, listener);
    }
    listeners.clear();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = () => {
      if (resolved) return;
      resolved = true;
      resolveStop({ type: 'signal', signal });
    };
    listeners.set(signal, listener);
    process.on(signal, listener);
  }

  return { promise, dispose };
}
