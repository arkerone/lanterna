import {
  type AttachProfileOptions,
  attachProfile,
  createKindRegistry,
  type ProfileKind,
  type ProfilePipelinePlugin,
  type RunProfileOptions,
  runProfile,
} from '@lanterna-profiler/core';
import {
  createAsyncProfileKindWithBuiltInDetectors,
  createCpuProfileKindWithBuiltInDetectors,
  createMemoryProfileKindWithBuiltInDetectors,
} from '@lanterna-profiler/detectors';
import { startActivityIndicator } from '../activity-indicator.js';
import { applyLanternaConfig, loadLanternaConfig } from '../config.js';
import { writeReportOutput } from '../output.js';
import { getProvidedFlags } from '../parse.js';
import { loadPlugins } from '../plugins.js';
import { createRunOrchestration } from '../run-orchestration.js';

type ParsedProfileOptions = {
  detectors: string[];
  kinds: string[];
  format: 'json' | 'text' | 'markdown';
  output?: string;
  pretty: boolean;
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
  heapSnapshotAnalysis: {
    enabled: boolean;
    outputDir?: string;
  };
  asyncMaxRecords: number;
  asyncStackDepth: number;
  asyncIncludeMicrotasks: boolean;
  asyncConcurrencyIntervalMs: number;
  asyncInstrumentation: 'off' | 'safe' | 'full';
  waitForUrl?: string;
  waitTimeoutMs?: number;
  captureDelayMs?: number;
  workload?: string;
};

type ExecuteProfileCommandOptions =
  | {
      mode: 'run';
      options: ParsedProfileOptions & Omit<RunProfileOptions, 'kinds'>;
      initialMessage: string;
      successMessage: string;
      failureMessage: string;
      readStderrSoFar: () => string;
      onTargetDiagnosticChunk: (chunk: string) => void;
    }
  | {
      mode: 'attach';
      options: ParsedProfileOptions & Omit<AttachProfileOptions, 'kinds'>;
      initialMessage: string;
      successMessage: string;
      failureMessage: string;
    };

export async function executeProfileCommand(command: ExecuteProfileCommandOptions): Promise<void> {
  const indicator = startActivityIndicator(command.initialMessage, {
    keepHistory: true,
  });

  try {
    const config = await loadLanternaConfig(process.cwd());
    const options = applyLanternaConfig(config, command.options, getProvidedFlags(command.options));
    const resolvedCommand = { ...command, options } as ExecuteProfileCommandOptions;
    const { kinds: pluginKinds, setupPipeline } = await resolvePluginContributions(
      options.detectors,
    );
    const cpuKind = buildCpuKind(resolvedCommand);
    const memoryKind = buildMemoryKind(resolvedCommand);
    const asyncKind = buildAsyncKind(resolvedCommand);
    const registry = createKindRegistry([cpuKind, memoryKind, asyncKind, ...pluginKinds]);
    const kinds = registry.resolveMany(options.kinds);
    const result = await runProfileCommand(resolvedCommand, kinds, setupPipeline, (message) => {
      indicator.update(message);
    });

    const qualityWarning = formatProfileQualityWarning(result.report);
    if (qualityWarning) indicator.update(qualityWarning);
    indicator.update('Writing the Lanterna report output...');
    await writeReportOutput(result.report, options.output, options.pretty, options.format, kinds);
    await result.afterReportWritten?.();
    indicator.succeed(command.successMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    indicator.fail(`${command.failureMessage}: ${message}`);
    if (error && typeof error === 'object') {
      Reflect.set(error, 'lanternaReported', true);
    }
    throw error;
  }
}

function formatProfileQualityWarning(report: {
  profiles?: {
    cpu?: {
      quality?: {
        confidence?: string;
        reasons?: string[];
        recommendations?: string[];
      };
    };
    async?: {
      quality?: {
        confidence?: string;
        reasons?: string[];
        recommendations?: string[];
        recordsDropped?: number;
        attachPartialCapture?: boolean;
        cpuAmbiguousSamples?: number;
        cdpAsyncStackCoverageRatio?: number;
        instrumentationMode?: string;
      };
    };
  };
}): string | undefined {
  const cpuQuality = report.profiles?.cpu?.quality;
  const asyncQuality = report.profiles?.async?.quality;
  const warnings: string[] = [];
  const recommendations: string[] = [];
  if (cpuQuality?.confidence === 'low') {
    warnings.push(...(cpuQuality.reasons?.filter(Boolean) ?? ['CPU capture quality is low']));
    recommendations.push(...(cpuQuality.recommendations?.filter(Boolean) ?? []));
  }
  if (asyncQuality && shouldWarnAsyncQuality(asyncQuality)) {
    warnings.push(...(asyncQuality.reasons?.filter(Boolean) ?? ['async capture quality is low']));
    recommendations.push(...(asyncQuality.recommendations?.filter(Boolean) ?? []));
  }
  if (warnings.length === 0) return undefined;
  const reasons = warnings;
  const reasonText = formatQualityReasons(reasons);
  const recommendationText = formatQualityRecommendations(recommendations);
  return `Low confidence profile: ${reasonText}.${recommendationText}`;
}

function shouldWarnAsyncQuality(quality: {
  confidence?: string;
  recordsDropped?: number;
  attachPartialCapture?: boolean;
  cpuAmbiguousSamples?: number;
  cdpAsyncStackCoverageRatio?: number;
  instrumentationMode?: string;
}): boolean {
  return (
    quality.confidence === 'low' ||
    (quality.recordsDropped ?? 0) > 0 ||
    Boolean(quality.attachPartialCapture) ||
    (quality.cpuAmbiguousSamples ?? 0) > 0 ||
    (quality.cdpAsyncStackCoverageRatio ?? 1) < 0.2
  );
}

function formatQualityReasons(reasons: string[]): string {
  if (reasons.length === 0) return 'capture quality is low';
  return reasons.join('; ');
}

function formatQualityRecommendations(recommendations: string[]): string {
  if (recommendations.length === 0) return '';
  return ` ${recommendations.join(' ')}`;
}

function buildAsyncKind(command: ExecuteProfileCommandOptions): ProfileKind {
  return createAsyncProfileKindWithBuiltInDetectors({
    maxRecords: command.options.asyncMaxRecords,
    asyncStackDepth: command.options.asyncStackDepth,
    includeMicrotasks: command.options.asyncIncludeMicrotasks,
    concurrencyIntervalMs: command.options.asyncConcurrencyIntervalMs,
    instrumentationMode: command.options.asyncInstrumentation,
    attachPartialCapture: command.mode === 'attach',
  });
}

function buildMemoryKind(command: ExecuteProfileCommandOptions): ProfileKind {
  return createMemoryProfileKindWithBuiltInDetectors({
    samplingIntervalBytes: command.options.heapSamplingIntervalBytes,
    memoryUsageIntervalMs: command.options.memoryUsageIntervalMs,
    includeMemoryUsageSamples: command.options.includeMemoryUsageSamples,
    heapSnapshotAnalysis: command.options.heapSnapshotAnalysis,
  });
}

function buildCpuKind(command: ExecuteProfileCommandOptions): ProfileKind {
  const sampleIntervalMicros = command.options.sampleIntervalMicros;
  if (command.mode === 'run') {
    return createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: command.readStderrSoFar,
      sampleIntervalMicros,
      deep: command.options.deep,
    });
  }
  return createCpuProfileKindWithBuiltInDetectors({
    readStderrSoFar: () => '',
    sampleIntervalMicros,
  });
}

async function runProfileCommand(
  command: ExecuteProfileCommandOptions,
  kinds: RunProfileOptions['kinds'],
  setupPipeline: ProfilePipelinePlugin | undefined,
  onProgressMessage: (message: string) => void,
): Promise<{
  report: Awaited<ReturnType<typeof runProfile>>;
  afterReportWritten?: () => Promise<void>;
}> {
  if (command.mode === 'run') {
    const { detectors: _specs, kinds: _kindIds, ...profileOptions } = command.options;
    void _specs;
    void _kindIds;
    const orchestration = createRunOrchestration(command.options, onProgressMessage);
    try {
      const runOptions: RunProfileOptions = {
        ...profileOptions,
        kinds,
        onTargetDiagnosticChunk: command.onTargetDiagnosticChunk,
      };
      if (setupPipeline) runOptions.setupPipeline = setupPipeline;
      if (orchestration.beforeCaptureStart) {
        runOptions.beforeCaptureStart = orchestration.beforeCaptureStart;
      }
      if (orchestration.onCaptureStarted) {
        runOptions.onCaptureStarted = orchestration.onCaptureStarted;
      }

      const report = await runProfile(runOptions, (event) => {
        onProgressMessage(event.message);
      });
      return { report, afterReportWritten: orchestration.afterReportWritten };
    } catch (error) {
      await orchestration.cleanup();
      throw error;
    }
  }

  const { detectors: _specs, kinds: _kindIds, ...profileOptions } = command.options;
  void _specs;
  void _kindIds;
  const attachOptions: AttachProfileOptions = {
    ...profileOptions,
    kinds,
  };
  if (setupPipeline) attachOptions.setupPipeline = setupPipeline;

  const report = await attachProfile(attachOptions, (event) => {
    onProgressMessage(event.message);
  });
  return { report };
}

async function resolvePluginContributions(
  flagSpecs: string[],
): Promise<{ kinds: ProfileKind[]; setupPipeline: ProfilePipelinePlugin | undefined }> {
  const cwd = process.cwd();
  if (flagSpecs.length === 0) return { kinds: [], setupPipeline: undefined };
  const { kinds, setups } = await loadPlugins(flagSpecs, cwd);
  if (setups.length === 0) return { kinds, setupPipeline: undefined };
  const setupPipeline: ProfilePipelinePlugin = async (pipeline, ctx) => {
    for (const setup of setups) {
      await setup(pipeline, ctx);
    }
  };
  return { kinds, setupPipeline };
}
