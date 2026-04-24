import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CaptureBundle,
  EventLoopHistogram,
  EventLoopSample,
  RawCpuProfile,
  RawDeopt,
  RawGcEvent,
} from '@lanterna-profiler/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROFILES_DIR = resolve(__dirname, 'fixtures-profiles');
export const CWD = '/app';

export function loadProfile(name: string): RawCpuProfile {
  return JSON.parse(
    readFileSync(resolve(PROFILES_DIR, `${name}.cpuprofile.json`), 'utf8'),
  ) as RawCpuProfile;
}

/**
 * Legacy-shape overrides — forwarded into runtime-signals / cpu kind data as
 * appropriate. Keeps the call sites of the existing tests short.
 */
export interface MakeRawOverrides extends Partial<CaptureBundle> {
  gcEvents?: RawGcEvent[];
  eventLoopSamples?: EventLoopSample[];
  eventLoopHistogram?: EventLoopHistogram;
  eventLoopResolutionMs?: number;
  eventLoopAvailable?: boolean;
  deopts?: RawDeopt[];
}

export function makeRaw(
  cpuProfile: RawCpuProfile,
  overrides: MakeRawOverrides = {},
): CaptureBundle {
  const {
    gcEvents,
    eventLoopSamples,
    eventLoopHistogram,
    eventLoopResolutionMs,
    eventLoopAvailable,
    deopts,
    runtimeSignals: runtimeSignalsOverride,
    kinds: kindsOverride,
    captureIntegrity: captureIntegrityOverride,
    target: targetOverride,
    ...rest
  } = overrides;

  return {
    target: {
      pid: 99999,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      cwd: CWD,
      ...(targetOverride ?? {}),
    },
    startedAtEpoch: Date.now(),
    durationMs: 5000,
    captureIntegrity: {
      controlChannel: true,
      controlChannelExpected: true,
      eventLoopTimed: false,
      gcTimed: false,
      cpuSamplesTimed: true,
      gcObserverAvailable: true,
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
      ...(captureIntegrityOverride ?? {}),
    },
    runtimeSignals: {
      gcEvents: gcEvents ?? [],
      eventLoopSamples: eventLoopSamples ?? [],
      ...(eventLoopHistogram !== undefined ? { eventLoopHistogram } : {}),
      eventLoopResolutionMs: eventLoopResolutionMs ?? 20,
      eventLoopAvailable: eventLoopAvailable ?? false,
      ...(runtimeSignalsOverride ?? {}),
    },
    kinds: {
      cpu: { cpuProfile, deopts: deopts ?? [] },
      ...((kindsOverride ?? {}) as CaptureBundle['kinds']),
    },
    ...rest,
  };
}
