import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachControlChannel } from '../src/runtime-signals/control-channel.js';
import { installLanternaFramework } from '../src/runtime-signals/hooks/framework.js';
import type { ControlEvent } from '../src/runtime-signals/schemas.js';

// The framework body is normally serialized via `Function.toString()` into a
// target's preload script and writes to a real fd; here we stub
// `process.getBuiltinModule('fs')` to intercept `writeSync` calls directly,
// in-process, so batching behavior is observable without a real pipe.

function stubFs() {
  const writeSyncCalls: string[] = [];
  let failNext = false;
  const fakeFs = {
    writeSync: (_fd: number, data: string) => {
      if (failNext) {
        failNext = false;
        throw new Error('EPIPE (simulated)');
      }
      writeSyncCalls.push(data);
      return data.length;
    },
  };
  const original = process.getBuiltinModule;
  vi.spyOn(process, 'getBuiltinModule').mockImplementation((name: string) => {
    if (name === 'fs' || name === 'node:fs') return fakeFs;
    return original?.(name);
  });
  return { writeSyncCalls, setFailNext: (value: boolean) => (failNext = value) };
}

function parseLines(payload: string): ControlEvent[] {
  const events: ControlEvent[] = [];
  const stream = new PassThrough();
  attachControlChannel(stream, { onEvent: (event) => events.push(event) });
  stream.write(payload);
  return events;
}

interface CapturedApi {
  controlChannel: { emit(event: object): boolean };
}

function install(options: { resolutionMs?: number; emitLifecycle?: boolean }): CapturedApi {
  let api: CapturedApi | undefined;
  installLanternaFramework(
    {
      resolutionMs: options.resolutionMs ?? 20,
      controlFd: 3,
      emitLifecycle: options.emitLifecycle,
    },
    (registeredApi) => {
      api = registeredApi as unknown as CapturedApi;
    },
  );
  if (!api) throw new Error('install did not register');
  return api;
}

describe('framework control-channel batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (globalThis as Record<string, unknown>).__LANTERNA_FRAMEWORK__;
    delete (globalThis as Record<string, unknown>).__LANTERNA_ATTACH_RUNTIME__;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces multiple emits into a single writeSync call once the flush timer fires', () => {
    const { writeSyncCalls } = stubFs();
    const api = install({});
    // hook-ready + capture-start are flushed immediately (critical) — clear
    // those before observing batching in isolation.
    writeSyncCalls.length = 0;

    for (let i = 0; i < 5; i += 1) {
      api.controlChannel.emit({ type: 'gc', atMs: i, kind: 'scavenge', durationMs: 0.1 });
    }
    expect(writeSyncCalls.length).toBe(0); // nothing written yet — still batching

    vi.advanceTimersByTime(50); // the flush timer fires
    expect(writeSyncCalls.length).toBe(1);
    const events = parseLines(writeSyncCalls[0] ?? '');
    expect(events.filter((e) => e.type === 'gc').length).toBe(5);

    globalThis.__LANTERNA_FRAMEWORK__?.dispose();
  });

  it('flushes synchronously, with no timer wait, once the batch reaches 64 events', () => {
    const { writeSyncCalls } = stubFs();
    const api = install({});
    writeSyncCalls.length = 0;

    for (let i = 0; i < 64; i += 1) {
      api.controlChannel.emit({ type: 'gc', atMs: i, kind: 'scavenge', durationMs: 0.1 });
    }

    // No timer advance at all — the 64-line threshold flushes synchronously.
    expect(writeSyncCalls.length).toBe(1);
    const events = parseLines(writeSyncCalls[0] ?? '');
    expect(events.filter((e) => e.type === 'gc').length).toBe(64);

    globalThis.__LANTERNA_FRAMEWORK__?.dispose();
  });

  it('increments controlChannelWriteErrors once and heartbeatDropped by the failed batch size', () => {
    const { setFailNext } = stubFs();
    // A very large resolutionMs keeps the real heartbeat scheduler from
    // firing during the test window, so only the manually emitted
    // heartbeat-typed events below are counted.
    const api = install({ resolutionMs: 1_000_000 });

    for (let i = 0; i < 3; i += 1) {
      api.controlChannel.emit({ type: 'heartbeat', atMs: i, lagMs: 0 });
    }
    setFailNext(true);
    vi.advanceTimersByTime(50); // flush timer fires, the batched write throws

    const framework = globalThis.__LANTERNA_FRAMEWORK__;
    const state = framework?.ensureInstalled();
    expect(state?.integrity.controlChannelWriteErrors).toBe(1);
    expect(state?.integrity.heartbeatDropped).toBe(3);

    framework?.dispose();
  });

  it('flushes app-complete immediately, draining any pending events first, without waiting for the flush timer', () => {
    const { writeSyncCalls } = stubFs();
    const api = install({ emitLifecycle: true });
    writeSyncCalls.length = 0;

    for (let i = 0; i < 3; i += 1) {
      api.controlChannel.emit({ type: 'heartbeat', atMs: i, lagMs: 0 });
    }
    process.emit('beforeExit', 0);

    // No 50ms flush-timer wait was needed: app-complete forced an immediate
    // flush that included the still-pending heartbeats.
    expect(writeSyncCalls.length).toBe(1);
    const events = parseLines(writeSyncCalls[0] ?? '');
    expect(events.filter((e) => e.type === 'heartbeat').length).toBe(3);
    expect(events[events.length - 1]?.type).toBe('app-complete');

    globalThis.__LANTERNA_FRAMEWORK__?.dispose();
  });

  it('real heartbeats do batch together over the flush window', () => {
    const { writeSyncCalls } = stubFs();
    install({ resolutionMs: 5 });
    writeSyncCalls.length = 0;

    // Advance well past the 50ms flush window so several real heartbeats
    // (fired every 5ms) accumulate and get flushed together.
    vi.advanceTimersByTime(60);

    expect(writeSyncCalls.length).toBe(1);
    const events = parseLines(writeSyncCalls[0] ?? '');
    expect(events.filter((e) => e.type === 'heartbeat').length).toBeGreaterThan(1);

    globalThis.__LANTERNA_FRAMEWORK__?.dispose();
  });
});
