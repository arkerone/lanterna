import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateSpawnedChild } from '../src/capture/spawn/terminate.js';

describe('terminateSpawnedChild', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not signal or leave timers when the child exits during the grace wait', async () => {
    vi.useFakeTimers();
    let resolveExit!: () => void;
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(),
    } as unknown as ChildProcess;

    const terminatePromise = terminateSpawnedChild(child, false, false, exitPromise);
    child.exitCode = 0;
    resolveExit();
    await terminatePromise;

    expect(child.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
