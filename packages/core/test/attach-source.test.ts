import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CdpClient } from '../src/inspector/client.js';

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  connectCdp: vi.fn(),
}));

vi.mock('../src/inspector/client.js', () => ({
  connectCdp: mocks.connectCdp,
}));

const { AttachSource } = await import('../src/capture/attach.js');

function neverSettlingCdp(): CdpClient {
  return {
    closed: false,
    send: async () => ({}),
    evaluate: () => new Promise(() => {}),
    on: () => () => {},
    onClose: () => () => {},
    close: mocks.close,
  };
}

function successfulCdp(): CdpClient {
  return {
    closed: false,
    send: async () => ({}),
    evaluate: async () => ({
      installed: true,
      capabilities: { eventLoop: true, gc: true, lifecycle: false },
      integrity: {
        controlChannelWriteErrors: 0,
        gcObserverSetupFailed: 0,
        heartbeatDropped: 0,
      },
    }),
    on: () => () => {},
    onClose: () => () => {},
    close: mocks.close,
  };
}

describe('AttachSource', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mocks.close.mockClear();
    mocks.connectCdp.mockReset();
  });

  it('times out runtime hook installation and closes CDP when the target does not answer', async () => {
    vi.useFakeTimers();
    mocks.connectCdp.mockResolvedValue(neverSettlingCdp());

    const connectPromise = new AttachSource().connect(
      {
        inspectUrl: 'ws://127.0.0.1:9229/test',
      },
      {
        preloadScript: '',
        attachScript: 'installHooks()',
        nodeOptions: [],
        controlFd: 3,
      },
    );

    const resultPromise = connectPromise.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    expect(String((result as Error).message)).toContain('timed out installing attach runtime hook');
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it('reports progress through attach runtime hook installation', async () => {
    mocks.connectCdp.mockResolvedValue(successfulCdp());
    const stages: string[] = [];

    await new AttachSource().connect(
      {
        inspectUrl: 'ws://127.0.0.1:9229/test',
        onProgress(event) {
          stages.push(event.stage);
        },
      },
      {
        preloadScript: '',
        attachScript: 'installHooks()',
        nodeOptions: [],
        controlFd: 3,
      },
    );

    expect(stages).toEqual(['resolve-target', 'connect-cdp', 'install-hooks']);
  });
});
