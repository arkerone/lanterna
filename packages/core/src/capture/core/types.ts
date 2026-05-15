import type { CaptureKindDataMap } from '../../kinds/core/types.js';
import type { MemoryUsageSample } from '../../report/types.js';
import type {
  EventLoopSampleData,
  ParsedTargetInfo,
  RawGcEventData,
} from '../../runtime-signals/schemas.js';

export interface SpawnStartOptions {
  command: string[];
  traceDeopt?: boolean;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  onProgress?: (event: {
    stage:
      | 'spawn-target'
      | 'wait-inspector'
      | 'connect-cdp'
      | 'prepare-runtime'
      | 'start-capture'
      | 'capture-running'
      | 'finalize-capture';
    message: string;
  }) => void;
}

export interface AttachStartOptions {
  pid?: number;
  inspectUrl?: string;
  onProgress?: (event: {
    stage:
      | 'resolve-target'
      | 'inspector-ready'
      | 'connect-cdp'
      | 'install-hooks'
      | 'start-capture'
      | 'capture-running'
      | 'finalize-capture';
    message: string;
  }) => void;
}

export type TargetInfo = ParsedTargetInfo & { pid: number };

export interface RawCpuProfile {
  nodes: Array<{
    id: number;
    callFrame: {
      functionName: string;
      scriptId: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    hitCount?: number;
    children?: number[];
    deoptReason?: string;
  }>;
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export type RawGcEvent = RawGcEventData;
export type EventLoopSample = EventLoopSampleData;

export interface RawDeopt {
  function: string;
  file: string;
  line: number;
  reason: string;
  bailoutType: string;
  count: number;
}

export type CaptureDiagnosticStage =
  | 'probe-install'
  | 'probe-start'
  | 'probe-stop'
  | 'probe-dispose'
  | 'runtime-read'
  | 'runtime-dispose'
  | 'analysis-contributor'
  | 'section-analyzer'
  | 'finding-analyzer'
  | 'finalize';

export interface CaptureDiagnostic {
  stage: CaptureDiagnosticStage;
  message: string;
  kindId?: string;
  analyzerId?: string;
}

export interface EventLoopHistogram {
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p99Ms: number;
}

export interface CaptureIntegrity {
  controlChannel: boolean;
  controlChannelExpected: boolean;
  eventLoopTimed: boolean;
  gcTimed: boolean;
  gcObserverAvailable: boolean;
  controlChannelWriteErrors: number;
  gcObserverSetupFailed: number;
  heartbeatDropped: number;
  diagnostics?: CaptureDiagnostic[];
  /** Per-kind integrity bucket. Populated by each kind's `contributeIntegrity`. */
  kinds: Record<string, unknown>;
}

/**
 * Always-on data captured by the runtime-signals installer: GC events and
 * event-loop samples/histogram. Consumed by every kind for correlation.
 */
export interface RuntimeSignalsData {
  gcEvents: RawGcEvent[];
  eventLoopSamples: EventLoopSample[];
  eventLoopHistogram?: EventLoopHistogram;
  eventLoopResolutionMs?: number;
  eventLoopAvailable: boolean;
}

/**
 * Raw capture output produced by {@link runCapture}. Replaces the legacy
 * CPU-hardcoded `RawCapture`. Kind-specific payloads live under `kinds`.
 */
export interface CaptureBundle {
  target: TargetInfo;
  startedAtEpoch: number;
  durationMs: number;
  captureIntegrity: CaptureIntegrity;
  runtimeSignals: RuntimeSignalsData;
  kinds: Partial<CaptureKindDataMap>;
}

/**
 * Signals accumulated live by the source (spawn-only, via control channel).
 * Returned by {@link ConnectedSource.drainLiveSignals} at capture stop.
 */
export interface LiveSourceSignals {
  gcEventsAbs: RawGcEvent[];
  eventLoopSamplesAbs: EventLoopSample[];
  eventLoopAvailable: boolean;
  eventLoopResolutionMs?: number;
  memoryUsageSamples?: MemoryUsageSample[];
  memoryUsageSampleIntervalMs?: number;
  integrityCounters?: {
    controlChannelWriteErrors: number;
    gcObserverSetupFailed: number;
    heartbeatDropped: number;
  };
  appCompleted?: boolean;
}

/**
 * A ConnectedSource is what a {@link ProfileSource} hands back to the
 * coordinator: a live CDP client + target descriptor + exit signal. The source
 * keeps the connection alive; the coordinator drives the capture against it.
 */
export interface ConnectedSource {
  cdp: import('../../inspector/client.js').CdpClient;
  target: TargetInfo;
  startedAtEpoch: number;
  /**
   * Initial capture-integrity flags the source knows upfront (e.g. spawn has
   * `controlChannelExpected: true`, attach has it `false`). Mutated by the
   * source as control-channel events arrive.
   */
  initialIntegrity: CaptureIntegrity;
  /** Resolves when the target process exits / inspector disconnects. */
  waitForExit(): Promise<void>;
  /**
   * Releases a startup breakpoint after the coordinator has installed hooks
   * and started probes. Spawn sources use this for `--inspect-brk`; attach
   * sources omit it because the target is already running.
   */
  releaseRuntime?(): Promise<void>;
  /**
   * Returns live-collected signals (control-channel for spawn; empty for
   * attach). The coordinator merges them with CDP-evaluated reads.
   */
  drainLiveSignals?(): LiveSourceSignals;
  /**
   * Called after the coordinator has collected everything. For spawn this
   * terminates the child; for attach this is a no-op.
   */
  finalize(opts: { appCompleted: boolean }): Promise<void>;
}

export interface ProfileSource<TOptions> {
  /**
   * Produces a {@link ConnectedSource} ready for capture. Receives an optional
   * preload-hook script that the source must inject into the target before
   * capture starts (spawn only — attach installs via CDP evaluate).
   */
  connect(options: TOptions, preload: PreloadContribution): Promise<ConnectedSource>;
}

/**
 * Runtime-hook contribution that the coordinator passes to the source. Spawn
 * sources inject `preloadScript` via `NODE_OPTIONS --require=<tmpfile>`; attach
 * sources evaluate `attachScript` over CDP after connecting.
 */
export interface PreloadContribution {
  preloadScript: string;
  attachScript: string;
  nodeOptions: string[];
  /** fd the child should write control events to (spawn only). */
  controlFd: number;
}
