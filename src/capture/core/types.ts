import type {
  EventLoopSampleData,
  ParsedTargetInfo,
  RawGcEventData,
} from '../../runtime-signals/schemas.js';

export interface SpawnStartOptions {
  command: string[];
  sampleIntervalMicros: number;
  deep: boolean;
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
  sampleIntervalMicros: number;
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

export interface EventLoopHistogram {
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p99Ms: number;
}

export interface CaptureIntegrity {
  controlChannel: boolean;
  eventLoopTimed: boolean;
  gcTimed: boolean;
  cpuSamplesTimed: boolean;
}

export interface RawCapture {
  target: TargetInfo;
  startedAtEpoch: number;
  durationMs: number;
  cpuProfile: RawCpuProfile;
  gcEvents: RawGcEvent[];
  eventLoopSamples: EventLoopSample[];
  eventLoopHistogram?: EventLoopHistogram;
  eventLoopResolutionMs?: number;
  eventLoopAvailable: boolean;
  captureIntegrity: CaptureIntegrity;
  deopts: RawDeopt[];
}

export interface SourceHandle {
  readonly target: TargetInfo;
  readonly startedAt: number;
  waitForExit(): Promise<void>;
  stop(): Promise<RawCapture>;
}

export type CaptureHandle = SourceHandle;

export interface ProfileSource<TOptions> {
  start(options: TOptions): Promise<SourceHandle>;
}
