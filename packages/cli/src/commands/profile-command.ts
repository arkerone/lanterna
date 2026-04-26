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
  createCpuProfileKindWithBuiltInDetectors,
  createMemoryProfileKindWithBuiltInDetectors,
} from '@lanterna-profiler/detectors';
import { startActivityIndicator } from '../activity-indicator.js';
import { loadLanternaConfig } from '../config.js';
import { writeReportOutput } from '../output.js';
import { loadPlugins } from '../plugins.js';

type ParsedProfileOptions = {
  detectors: string[];
  kinds: string[];
  output?: string;
  pretty: boolean;
  heapSamplingIntervalBytes: number;
  memoryUsageIntervalMs: number;
  includeMemoryUsageSamples: boolean;
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
    const { kinds: pluginKinds, setupPipeline } = await resolvePluginContributions(
      command.options.detectors,
    );
    const cpuKind = buildCpuKind(command);
    const memoryKind = buildMemoryKind(command);
    const registry = createKindRegistry([cpuKind, memoryKind, ...pluginKinds]);
    const kinds = registry.resolveMany(command.options.kinds);
    const report = await runProfileCommand(command, kinds, setupPipeline, (message) => {
      indicator.update(message);
    });

    indicator.update('Writing the Lanterna report output...');
    await writeReportOutput(report, command.options.output, command.options.pretty, kinds);
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

function buildMemoryKind(command: ExecuteProfileCommandOptions): ProfileKind {
  return createMemoryProfileKindWithBuiltInDetectors({
    samplingIntervalBytes: command.options.heapSamplingIntervalBytes,
    memoryUsageIntervalMs: command.options.memoryUsageIntervalMs,
    includeMemoryUsageSamples: command.options.includeMemoryUsageSamples,
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
) {
  if (command.mode === 'run') {
    const { detectors: _specs, kinds: _kindIds, ...profileOptions } = command.options;
    void _specs;
    void _kindIds;
    return runProfile(
      {
        ...profileOptions,
        kinds,
        onTargetDiagnosticChunk: command.onTargetDiagnosticChunk,
        ...(setupPipeline ? { setupPipeline } : {}),
      },
      (event) => {
        onProgressMessage(event.message);
      },
    );
  }

  const { detectors: _specs, kinds: _kindIds, ...profileOptions } = command.options;
  void _specs;
  void _kindIds;
  return attachProfile(
    {
      ...profileOptions,
      kinds,
      ...(setupPipeline ? { setupPipeline } : {}),
    },
    (event) => {
      onProgressMessage(event.message);
    },
  );
}

async function resolvePluginContributions(
  flagSpecs: string[],
): Promise<{ kinds: ProfileKind[]; setupPipeline: ProfilePipelinePlugin | undefined }> {
  const cwd = process.cwd();
  const config = await loadLanternaConfig(cwd);
  const specs = [...(config?.detectors ?? []), ...flagSpecs];
  if (specs.length === 0) return { kinds: [], setupPipeline: undefined };
  const { kinds, setups } = await loadPlugins(specs, cwd);
  if (setups.length === 0) return { kinds, setupPipeline: undefined };
  const setupPipeline: ProfilePipelinePlugin = async (pipeline, ctx) => {
    for (const setup of setups) {
      await setup(pipeline, ctx);
    }
  };
  return { kinds, setupPipeline };
}
