import type { AnalysisPipeline } from '../analysis/core/pipeline.js';
import type { FindingAnalyzer, SectionAnalyzer } from '../analysis/core/types.js';
import type { ProfileKind } from '../kinds/core/types.js';

export interface ProfilePluginContext {
  readonly cwd: string;
  readonly mode: 'spawn' | 'attach';
}

export type ProfilePipelinePlugin = (
  pipeline: AnalysisPipeline,
  ctx: ProfilePluginContext,
) => void | Promise<void>;

export interface RunProfileOptions {
  command: string[];
  durationMs?: number;
  output?: string;
  pretty: boolean;
  deep?: boolean;
  sampleIntervalMicros?: number;
  /** Profile kinds to capture. Defaults to `[cpu]`. */
  kinds?: ProfileKind[];
  extraAnalyzers?: (FindingAnalyzer | SectionAnalyzer)[];
  setupPipeline?: ProfilePipelinePlugin;
  onTargetDiagnosticChunk?: (chunk: string) => void;
  beforeCaptureStart?: () => void | Promise<void>;
  onCaptureStarted?: () => void | Promise<void>;
}

export interface AttachProfileOptions {
  pid?: number;
  inspectUrl?: string;
  promptForTarget?: boolean;
  durationMs?: number;
  output?: string;
  pretty: boolean;
  sampleIntervalMicros?: number;
  kinds?: ProfileKind[];
  extraAnalyzers?: (FindingAnalyzer | SectionAnalyzer)[];
  setupPipeline?: ProfilePipelinePlugin;
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
