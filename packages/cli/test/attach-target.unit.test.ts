import { describe, expect, it } from 'vitest';
import {
  classifyAttachMode,
  isAttachableAppProcess,
  type RunningNodeProcess,
  type RunningNodeProcessCandidate,
} from '../src/attach-target.js';

function makeCandidate(
  over: Partial<RunningNodeProcessCandidate> = {},
): RunningNodeProcessCandidate {
  return {
    pid: 12345,
    runtime: 'node',
    command: 'node app.js',
    age: '2m',
    kind: 'app',
    ...over,
  };
}

describe('classifyAttachMode', () => {
  it('returns "cdp-ready" when the inspector target is already exposed', () => {
    const entry = makeCandidate();
    expect(classifyAttachMode(entry, true, false)).toBe('cdp-ready');
    // hasInspectorTarget wins over kind/canAttachByPid
    expect(classifyAttachMode(makeCandidate({ kind: 'tooling' }), true, false)).toBe('cdp-ready');
  });

  it('returns "pid-attach" for an app process when SIGUSR1 attach is feasible', () => {
    expect(classifyAttachMode(makeCandidate({ kind: 'app' }), false, true)).toBe('pid-attach');
  });

  it('returns undefined for tooling processes without an inspector', () => {
    expect(classifyAttachMode(makeCandidate({ kind: 'tooling' }), false, true)).toBeUndefined();
  });

  it('returns undefined when neither inspector nor pid attach is available', () => {
    expect(classifyAttachMode(makeCandidate(), false, false)).toBeUndefined();
  });
});

describe('isAttachableAppProcess', () => {
  it('returns true for an app process', () => {
    const entry: RunningNodeProcess = {
      ...makeCandidate({ kind: 'app' }),
      attachMode: 'pid-attach',
    };
    expect(isAttachableAppProcess(entry)).toBe(true);
  });

  it('returns false for tooling processes', () => {
    const entry: RunningNodeProcess = {
      ...makeCandidate({ kind: 'tooling' }),
      attachMode: 'cdp-ready',
    };
    expect(isAttachableAppProcess(entry)).toBe(false);
  });

  it('returns false for undefined entries (used as a type guard on user picks)', () => {
    expect(isAttachableAppProcess(undefined)).toBe(false);
  });
});
