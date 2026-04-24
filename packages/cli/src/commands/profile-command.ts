import {
  type AttachProfileOptions,
  attachProfile,
  createDefaultKindRegistry,
  type ProfilePipelinePlugin,
  type RunProfileOptions,
  runProfile,
} from '@lanterna-profiler/core';
import { createBuiltInFindingAnalyzers } from '@lanterna-profiler/detectors';
import { startActivityIndicator } from '../activity-indicator.js';
import { loadLanternaConfig } from '../config.js';
import { writeReportOutput } from '../output.js';
import { loadPlugins } from '../plugins.js';

type ParsedProfileOptions = {
  detectors: string[];
  kinds: string[];
  output?: string;
  pretty: boolean;
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
    const setupPipeline = await resolveSetupPipeline(command.options.detectors);
    const kindRegistry =
      command.mode === 'run'
        ? createDefaultKindRegistry({ readStderrSoFar: command.readStderrSoFar })
        : createDefaultKindRegistry();
    const kinds = kindRegistry.resolveMany(command.options.kinds);
    const report = await runProfileCommand(command, kinds, setupPipeline, (message) => {
      indicator.update(message);
    });

    indicator.update('Writing the Lanterna report output...');
    await writeReportOutput(report, command.options.output, command.options.pretty);
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
        analyzers: createBuiltInFindingAnalyzers(),
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
      analyzers: createBuiltInFindingAnalyzers(),
      ...(setupPipeline ? { setupPipeline } : {}),
    },
    (event) => {
      onProgressMessage(event.message);
    },
  );
}

async function resolveSetupPipeline(
  flagSpecs: string[],
): Promise<ProfilePipelinePlugin | undefined> {
  const cwd = process.cwd();
  const config = await loadLanternaConfig(cwd);
  const specs = [...(config?.detectors ?? []), ...flagSpecs];
  if (specs.length === 0) return undefined;
  const plugins = await loadPlugins(specs, cwd);
  return async (pipeline, ctx) => {
    for (const plugin of plugins) {
      await plugin(pipeline, ctx);
    }
  };
}
