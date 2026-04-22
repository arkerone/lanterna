import { describe, expect, it } from 'vitest';
import { installLanternaRuntimeHook } from '../src/runtime-signals/hooks/hook-core.js';
import { readRuntimeIntegrity } from '../src/runtime-signals/readers/integrity.js';

describe('installLanternaRuntimeHook capture integrity counters', () => {
  it('reports control-channel write failures when the configured fd is unusable', () => {
    delete globalThis.__LANTERNA_ATTACH_RUNTIME__;
    delete globalThis.__LANTERNA_EVENT_LOOP__;
    delete globalThis.__LANTERNA_GC__;

    const result = installLanternaRuntimeHook({
      controlFd: 999_999_999,
      resolutionMs: 1_000,
      emitLifecycle: false,
    });

    expect(result.integrity.controlChannelWriteErrors).toBeGreaterThan(0);
    expect(result.integrity.gcObserverSetupFailed).toBe(0);
    expect(result.integrity.heartbeatDropped).toBe(0);

    globalThis.__LANTERNA_EVENT_LOOP__?.reset();
  });

  it('reports GC observer setup failures directly', () => {
    delete globalThis.__LANTERNA_ATTACH_RUNTIME__;
    delete globalThis.__LANTERNA_EVENT_LOOP__;
    delete globalThis.__LANTERNA_GC__;
    const originalPerformanceObserver = globalThis.PerformanceObserver;
    globalThis.PerformanceObserver = class {
      observe(): void {
        throw new Error('observer unavailable');
      }
    } as typeof PerformanceObserver;

    try {
      const result = installLanternaRuntimeHook({ controlFd: -1, emitLifecycle: false });

      expect(result.integrity.gcObserverSetupFailed).toBe(1);
      expect(result.capabilities?.gc).toBe(false);
    } finally {
      globalThis.PerformanceObserver = originalPerformanceObserver;
      delete globalThis.__LANTERNA_ATTACH_RUNTIME__;
      delete globalThis.__LANTERNA_EVENT_LOOP__;
      delete globalThis.__LANTERNA_GC__;
    }
  });
});

describe('readRuntimeIntegrity', () => {
  it('reads integrity counters through CDP instead of the control channel', async () => {
    const integrity = await readRuntimeIntegrity({
      closed: false,
      async evaluate() {
        return {
          controlChannelWriteErrors: 2,
          gcObserverSetupFailed: 1,
          heartbeatDropped: 3,
        };
      },
      async send() {
        return {};
      },
      on() {
        return () => {};
      },
      onClose() {
        return () => {};
      },
      async close() {},
    });

    expect(integrity).toEqual({
      controlChannelWriteErrors: 2,
      gcObserverSetupFailed: 1,
      heartbeatDropped: 3,
    });
  });
});
