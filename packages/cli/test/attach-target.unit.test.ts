import { describe, expect, it } from 'vitest';
import { classifyAttachMode } from '../src/attach-target.js';

describe('classifyAttachMode', () => {
  it('returns "cdp-ready" when the inspector target is already exposed', () => {
    expect(classifyAttachMode(true, false)).toBe('cdp-ready');
  });

  it('returns "pid-attach" when SIGUSR1 attach is feasible', () => {
    expect(classifyAttachMode(false, true)).toBe('pid-attach');
  });

  it('returns undefined when neither inspector nor pid attach is available', () => {
    expect(classifyAttachMode(false, false)).toBeUndefined();
  });
});
