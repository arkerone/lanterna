import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLanternaFramework } from '../src/runtime-signals/hooks/framework.js';
import {
  installMemoryUsage,
  type MemoryUsageInstallerApi,
} from '../src/runtime-signals/hooks/installers/memory-usage.js';
import { installRuntimeSignals } from '../src/runtime-signals/hooks/installers/runtime-signals.js';

// These installer bodies are normally serialized via `Function.toString()`
// into a target's preload script, but they're plain, self-contained
// functions — invoking them directly here (in-process, no CDP/spawn) is
// enough to exercise the drop-counter logic without waiting out real caps.

describe('framework heartbeat buffer overflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (globalThis as Record<string, unknown>).__LANTERNA_FRAMEWORK__;
    delete (globalThis as Record<string, unknown>).__LANTERNA_ATTACH_RUNTIME__;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments eventLoopSamplesDropped when the heartbeat buffer is trimmed', () => {
    const result = installLanternaFramework(
      { resolutionMs: 1, controlFd: -1, emitLifecycle: false },
      () => {},
    );
    expect(result.installed).toBe(true);

    // HEARTBEAT_SAMPLE_CAP is 90_000, dropped in 1_000-sample chunks.
    vi.advanceTimersByTime(90_500);

    const framework = globalThis.__LANTERNA_FRAMEWORK__;
    const state = framework?.ensureInstalled();
    expect(state?.integrity.eventLoopSamplesDropped).toBeGreaterThanOrEqual(1_000);

    framework?.dispose();
  });
});

describe('runtime-signals installer GC buffer overflow', () => {
  it('increments gcEventsDropped when the GC buffer is trimmed', () => {
    type GcCallback = (list: {
      getEntries: () => Array<{ startTime: number; duration: number }>;
    }) => void;
    let observerCallback: GcCallback | undefined;
    class FakePerformanceObserver {
      constructor(cb: GcCallback) {
        observerCallback = cb;
      }
      observe(): void {}
      disconnect(): void {}
    }

    const integrity = { gcObserverSetupFailed: 0, gcEventsDropped: 0 };
    const capabilities = { eventLoop: false, gc: false, lifecycle: false };
    const heartbeatSamples: Array<{ atMs: number; lagMs: number }> = [];

    // Node exposes a real global PerformanceObserver; the installer prefers
    // it over `perf_hooks`, so stub the global directly to intercept it.
    const originalPerformanceObserver = globalThis.PerformanceObserver;
    (globalThis as { PerformanceObserver: unknown }).PerformanceObserver = FakePerformanceObserver;

    try {
      installRuntimeSignals({
        performance: globalThis.performance,
        resolutionMs: 20,
        controlChannel: { emit: () => true },
        integrity,
        registerGlobal: (name, value) => {
          (globalThis as Record<string, unknown>)[name] = value;
        },
        addResetHook: () => {},
        addDisposeHook: () => {},
        getBuiltin: () => null,
        markGcObserverFailure: () => {},
        startCapture: () => {},
        heartbeatSamples,
        capabilities,
      });

      expect(observerCallback).toBeDefined();

      // GC_EVENT_CAP is 50_000, dropped in 500-event chunks.
      const entries = Array.from({ length: 50_500 }, (_, i) => ({ startTime: i, duration: 1 }));
      observerCallback?.({ getEntries: () => entries });

      expect(integrity.gcEventsDropped).toBeGreaterThanOrEqual(500);

      const gc = (globalThis as Record<string, unknown>).__LANTERNA_GC__ as {
        read: () => unknown[];
      };
      expect(gc.read().length).toBeLessThan(50_500);
    } finally {
      (globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
        originalPerformanceObserver;
      delete (globalThis as Record<string, unknown>).__LANTERNA_GC__;
      delete (globalThis as Record<string, unknown>).__LANTERNA_EVENT_LOOP__;
    }
  });
});

describe('memory-usage installer sample buffer overflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments memoryUsageSamplesDropped when the sample buffer is trimmed', () => {
    const integrity = { memoryUsageSamplesDropped: 0 };
    const api: MemoryUsageInstallerApi = {
      performance: globalThis.performance,
      controlChannel: { emit: () => true },
      integrity,
      registerGlobal: (name, value) => {
        (globalThis as Record<string, unknown>)[name] = value;
      },
      addResetHook: () => {},
      addDisposeHook: () => {},
      releaseInstaller: () => {},
    };

    // MEMORY_USAGE_SAMPLE_CAP is 20_000, dropped in 200-sample chunks.
    // sampleIntervalMs=1 lets fake-timer advancement synchronously fire
    // enough interval ticks to cross the cap.
    installMemoryUsage(api, 1);
    vi.advanceTimersByTime(20_300);

    expect(integrity.memoryUsageSamplesDropped).toBeGreaterThanOrEqual(200);

    const memory = (globalThis as Record<string, unknown>).__LANTERNA_MEMORY__ as {
      read: () => { samples: unknown[] };
      disable: () => void;
    };
    expect(memory.read().samples.length).toBeLessThan(20_300);
    memory.disable();
    delete (globalThis as Record<string, unknown>).__LANTERNA_MEMORY__;
  });
});
