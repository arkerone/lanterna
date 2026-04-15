export interface StartOptions {
  command: string[];
  sampleIntervalMicros: number;
  deep: boolean;
}

export interface TargetInfo {
  pid: number;
  nodeVersion: string;
  v8Version: string;
  platform: string;
  arch: string;
  cwd: string;
}

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

export interface RawGcEvent {
  atMs: number;
  kind: string;
  durationMs: number;
}

export interface EventLoopSample {
  atMs: number;
  lagMs: number;
}

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

export interface ProfileSource {
  start(options: StartOptions): Promise<SourceHandle>;
}
