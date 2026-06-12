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

const { openInspectorForPid, readInspectableTargetsByPid, readInspectorTargets } = await import(
  '../src/inspector/discovery.js'
);

function withPlatform(platform: NodeJS.Platform, fn: () => Promise<void>): Promise<void> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return fn().finally(() => {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });
}

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

  it('discovers an inspector that only listens on IPv6 loopback and dedupes dual-stack hits', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('[::1]') && url.includes(':9229/')) {
          return Promise.resolve(
            new Response(JSON.stringify([{ webSocketDebuggerUrl: 'ws://[::1]:9229/ipv6' }]), {
              status: 200,
            }),
          );
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      });

    const targets = await readInspectorTargets();

    expect(targets).toEqual([{ webSocketDebuggerUrl: 'ws://[::1]:9229/ipv6' }]);
    // Both loopback families are probed, so IPv4 is attempted before IPv6.
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:9229/json/list',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://[::1]:9229/json/list',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns an already-open inspector endpoint for a pid on Windows', async () => {
    await withPlatform('win32', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify([{ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/win' }]), {
          status: 200,
        }),
      );
      mocks.connectCdp.mockResolvedValue({ close: vi.fn(async () => {}) } as unknown as CdpClient);
      mocks.fetchTargetInfo.mockResolvedValue({ pid: 4242 });

      await expect(openInspectorForPid(4242)).resolves.toBe('ws://127.0.0.1:9229/win');
    });
  });

  it('fails with a Windows-specific message when no inspector is already open', async () => {
    await withPlatform('win32', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(openInspectorForPid(4242)).rejects.toThrow(/Windows/);
      await expect(openInspectorForPid(4242)).rejects.toThrow(/--inspect-url/);
    });
  });

  it.skipIf(process.platform === 'win32')(
    'refuses to SIGUSR1 a pid whose executable is not a Node.js runtime',
    async () => {
      // SIGUSR1's default disposition terminates non-Node processes, so a
      // typo'd --pid must never reach process.kill.
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const { spawn } = await import('node:child_process');
      const child = spawn('sleep', ['30'], { stdio: 'ignore' });
      try {
        await new Promise((resolve) => child.once('spawn', resolve));
        const pid = child.pid;
        if (!pid) throw new Error('sleep child has no pid');
        await expect(openInspectorForPid(pid)).rejects.toThrow(/refusing to signal pid/);
        // The guard must have refused before signalling: the child is alive.
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();
      } finally {
        child.kill('SIGKILL');
      }
    },
  );
});
