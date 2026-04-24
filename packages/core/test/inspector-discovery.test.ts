import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../src/inspector/client.js';

const mocks = vi.hoisted(() => ({
  connectCdp: vi.fn(),
  fetchTargetInfo: vi.fn(),
}));

vi.mock('../src/inspector/client.js', () => ({
  connectCdp: mocks.connectCdp,
}));

vi.mock('../src/inspector/runtime.js', () => ({
  fetchTargetInfo: mocks.fetchTargetInfo,
}));

const { readInspectableTargetsByPid, readInspectorTargets } = await import(
  '../src/inspector/discovery.js'
);

describe('inspector discovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mocks.connectCdp.mockReset();
    mocks.fetchTargetInfo.mockReset();
  });

  it('bounds every inspector target-list fetch with a timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const targetsPromise = readInspectorTargets().then(() => 'resolved');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(Promise.race([targetsPromise, Promise.resolve('pending')])).resolves.toBe(
      'resolved',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds PID metadata reads for stale inspector targets and closes CDP', async () => {
    vi.useFakeTimers();
    const cdp = {
      close: vi.fn(async () => {}),
    } as unknown as CdpClient;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/test' }]), {
        status: 200,
      }),
    );
    mocks.connectCdp.mockResolvedValue(cdp);
    mocks.fetchTargetInfo.mockImplementation(() => new Promise(() => {}));

    const targetsByPidPromise = readInspectableTargetsByPid();
    await vi.advanceTimersByTimeAsync(10_000);
    const targetsByPid = await targetsByPidPromise;

    expect(targetsByPid.size).toBe(0);
    expect(cdp.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
