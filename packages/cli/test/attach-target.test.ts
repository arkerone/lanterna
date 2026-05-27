import { describe, expect, it } from 'vitest';
import { classifyAttachMode } from '../src/attach-target.js';

describe('attach target classification', () => {
  it('marks a process as CDP ready when an inspector target already exists', () => {
    expect(classifyAttachMode(true, true)).toBe('cdp-ready');
  });

  it('marks a process as PID attach only when it is alive and signalable', () => {
    expect(classifyAttachMode(false, true)).toBe('pid-attach');
    expect(classifyAttachMode(false, false)).toBeUndefined();
  });
});
