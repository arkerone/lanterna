import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawCapture, RawCpuProfile } from '../src/capture/core/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROFILES_DIR = resolve(__dirname, 'fixtures-profiles');
export const CWD = '/app';

export function loadProfile(name: string): RawCpuProfile {
  return JSON.parse(
    readFileSync(resolve(PROFILES_DIR, `${name}.cpuprofile.json`), 'utf8'),
  ) as RawCpuProfile;
}

export function makeRaw(
  cpuProfile: RawCpuProfile,
  overrides: Partial<RawCapture> = {},
): RawCapture {
  return {
    target: {
      pid: 99999,
      nodeVersion: 'v24.0.0',
      v8Version: '12.0.0',
      platform: 'linux',
      arch: 'x64',
      cwd: CWD,
    },
    startedAtEpoch: Date.now(),
    durationMs: 5000,
    cpuProfile,
    gcEvents: [],
    eventLoopSamples: [],
    eventLoopResolutionMs: 20,
    eventLoopAvailable: false,
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
    },
    deopts: [],
    ...overrides,
  };
}
