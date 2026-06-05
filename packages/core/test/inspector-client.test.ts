import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (params: unknown) => void;

interface FakeClient {
  sent: Array<{ method: string; params?: Record<string, unknown> }>;
  on(event: string, handler: Listener): FakeClient;
  removeListener(event: string, handler: Listener): FakeClient;
  emit(event: string, params?: unknown): void;
  listenerCount(event: string): number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _ws: { readyState: number; terminate: ReturnType<typeof vi.fn> };
}

const h = vi.hoisted(() => ({
  createClient: undefined as undefined | (() => FakeClient),
}));

vi.mock('chrome-remote-interface', () => ({
  default: vi.fn(async () => {
    if (!h.createClient) throw new Error('test did not set a fake client');
    return h.createClient();
  }),
}));

const { connectCdp } = await import('../src/inspector/client.js');

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const listeners = new Map<string, Set<Listener>>();
  const client: FakeClient = {
    sent: [],
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return client;
    },
    removeListener(event, handler) {
      listeners.get(event)?.delete(handler);
      return client;
    },
    emit(event, params) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(params);
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      client.sent.push({ method, params });
      return { result: { value: 'EVAL' } };
    }),
    close: vi.fn(async () => {}),
    _ws: { readyState: 1, terminate: vi.fn() },
    ...overrides,
  };
  return client;
}

afterEach(() => {
  h.createClient = undefined;
  vi.useRealTimers();
});

describe('connectCdp', () => {
  it('proxies send to the underlying client and returns its result', async () => {
    const fake = makeFakeClient({
      send: vi.fn(async () => ({ ok: true })),
    });
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    const result = await cdp.send('Profiler.start', { a: 1 });
    expect(result).toEqual({ ok: true });
    expect(fake.send).toHaveBeenCalledWith('Profiler.start', { a: 1 });
    expect(cdp.closed).toBe(false);
  });

  it('rejects send after the connection is closed', async () => {
    const fake = makeFakeClient();
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    await cdp.close();
    expect(cdp.closed).toBe(true);
    await expect(cdp.send('Profiler.start')).rejects.toThrow('CDP connection closed');
  });

  it('evaluate calls Runtime.evaluate with returnByValue and unwraps result.value', async () => {
    const fake = makeFakeClient({
      send: vi.fn(async () => ({ result: { value: 42 } })),
    });
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    const value = await cdp.evaluate('1 + 41', { awaitPromise: true });
    expect(value).toBe(42);
    expect(fake.send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: '1 + 41',
      returnByValue: true,
      awaitPromise: true,
    });
  });

  it('on registers an unsubscribable handler and swallows handler errors', async () => {
    const fake = makeFakeClient();
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    const calls: unknown[] = [];
    const off = cdp.on('Debugger.paused', (params) => {
      calls.push(params);
      throw new Error('handler boom');
    });
    // Throwing inside the handler must not propagate out of the emit.
    expect(() => fake.emit('Debugger.paused', { hit: 1 })).not.toThrow();
    expect(calls).toEqual([{ hit: 1 }]);

    off();
    fake.emit('Debugger.paused', { hit: 2 });
    expect(calls).toEqual([{ hit: 1 }]);
    expect(fake.listenerCount('Debugger.paused')).toBe(0);
  });

  it('fires onClose handlers exactly once on disconnect', async () => {
    const fake = makeFakeClient();
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    let closeCount = 0;
    cdp.onClose(() => {
      closeCount++;
    });

    fake.emit('disconnect');
    fake.emit('disconnect');
    expect(closeCount).toBe(1);
    expect(cdp.closed).toBe(true);
  });

  it('does not call an unsubscribed onClose handler', async () => {
    const fake = makeFakeClient();
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    let called = false;
    const off = cdp.onClose(() => {
      called = true;
    });
    off();
    fake.emit('disconnect');
    expect(called).toBe(false);
  });

  it('close is idempotent and calls the underlying client once', async () => {
    const fake = makeFakeClient();
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    await cdp.close();
    await cdp.close();
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it('force-terminates the websocket when graceful close times out', async () => {
    vi.useFakeTimers();
    const fake = makeFakeClient({
      // Never resolves — forces the graceful-close timeout path.
      close: vi.fn(() => new Promise<void>(() => {})),
    });
    h.createClient = () => fake;
    const cdp = await connectCdp('ws://target');

    const closing = cdp.close();
    await vi.advanceTimersByTimeAsync(1000);
    await closing;

    expect(fake._ws.terminate).toHaveBeenCalledTimes(1);
    expect(cdp.closed).toBe(true);
  });
});
