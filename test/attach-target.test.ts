import { describe, expect, it } from 'vitest';
import {
  classifyAttachMode,
  isAttachableAppProcess,
  type RunningNodeProcessCandidate,
} from '../src/cli/attach-target.js';

function createCandidate(overrides: Partial<RunningNodeProcessCandidate> = {}): RunningNodeProcessCandidate {
  return {
    pid: 4242,
    runtime: 'node',
    command: 'node server.js',
    cwd: '/tmp/app',
    age: '12s',
    cpu: 12.5,
    memory: 4.2,
    kind: 'app',
    ...overrides,
  };
}

describe('attach target classification', () => {
  it('marks a process as CDP ready when an inspector target already exists', () => {
    const candidate = createCandidate();

    expect(classifyAttachMode(candidate, true, true)).toBe('cdp-ready');
  });

  it('marks a process as PID attach only when it is alive and signalable', () => {
    const candidate = createCandidate();

    expect(classifyAttachMode(candidate, false, true)).toBe('pid-attach');
    expect(classifyAttachMode(candidate, false, false)).toBeUndefined();
  });

  it('does not mark tooling processes as attachable app targets', () => {
    const candidate = createCandidate({ kind: 'tooling' });

    expect(classifyAttachMode(candidate, false, true)).toBeUndefined();
    expect(isAttachableAppProcess(undefined)).toBe(false);
  });
});
