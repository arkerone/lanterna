import type { HookInstaller } from '../framework.js';

/**
 * The runtime-signals installer registers the GC observer and the event-loop
 * histogram + heartbeat read/reset globals consumed by the core readers.
 *
 * Always included in every capture: CPU correlation, memory profiling, and
 * async profiling all benefit from GC and event-loop lag data.
 *
 * The fragment runs inside the framework's registration callback and has
 * access to `__lanterna` helpers (see `framework.ts`).
 */
export const runtimeSignalsInstaller: HookInstaller = {
  id: 'runtime-signals',
  source: `(${installRuntimeSignals.toString()})(__lanterna);`,
};

// Serialized body — self-contained, no closures over this file.
function installRuntimeSignals(api: {
  performance: typeof globalThis.performance;
  resolutionMs: number;
  controlChannel: { emit(event: object): boolean };
  integrity: { gcObserverSetupFailed: number };
  registerGlobal(name: string, value: unknown): void;
  addResetHook(fn: () => void): void;
  getBuiltin<T extends object>(name: string): T | null;
  markGcObserverFailure(): void;
  startCapture(): void;
  heartbeatSamples: Array<{ atMs: number; lagMs: number }>;
  capabilities: { eventLoop: boolean; gc: boolean; lifecycle: boolean };
}) {
  interface PerfHooksBuiltin {
    PerformanceObserver?: typeof PerformanceObserver;
    monitorEventLoopDelay?: (options: { resolution: number }) => {
      count: number;
      max: number;
      mean: number;
      percentile: (value: number) => number;
      reset?: () => void;
      enable?: () => void;
    };
  }

  const perfHooks = api.getBuiltin<PerfHooksBuiltin>('perf_hooks');
  const PerformanceObserverCtor = globalThis.PerformanceObserver || perfHooks?.PerformanceObserver;
  const monitorEventLoopDelay = perfHooks?.monitorEventLoopDelay;

  let histogram: ReturnType<NonNullable<PerfHooksBuiltin['monitorEventLoopDelay']>> | null = null;
  if (typeof monitorEventLoopDelay === 'function') {
    try {
      histogram = monitorEventLoopDelay({ resolution: api.resolutionMs });
      histogram.enable?.();
    } catch {
      histogram = null;
    }
  }

  const gcEvents: Array<{ atMs: number; kind: string; durationMs: number }> = [];
  let gcObserver: PerformanceObserver | null = null;

  const gcKindName = (kind: number): string => {
    if (kind === 1) return 'scavenge';
    if (kind === 2) return 'markSweep';
    if (kind === 4) return 'incremental';
    return 'other';
  };

  if (typeof PerformanceObserverCtor === 'function') {
    try {
      type GcEntry = PerformanceEntry & { detail?: { kind?: number } };
      const observer = new PerformanceObserverCtor((list: { getEntries: () => GcEntry[] }) => {
        for (const entry of list.getEntries()) {
          const event = {
            atMs: entry.startTime,
            kind: entry.detail?.kind !== undefined ? gcKindName(entry.detail.kind) : 'other',
            durationMs: entry.duration,
          };
          gcEvents.push(event);
          api.controlChannel.emit({ type: 'gc', ...event });
        }
      });
      observer.observe({ entryTypes: ['gc'], buffered: false });
      gcObserver = observer;
    } catch {
      api.markGcObserverFailure();
      gcObserver = null;
    }
  } else {
    api.markGcObserverFailure();
  }

  api.capabilities.eventLoop = true;
  api.capabilities.gc = Boolean(gcObserver);

  api.addResetHook(() => {
    histogram?.reset?.();
    gcEvents.length = 0;
  });

  api.registerGlobal('__LANTERNA_EVENT_LOOP__', {
    markCaptureStart: () => {
      api.startCapture();
    },
    read: () => ({
      samples: api.heartbeatSamples.slice(),
      summary: histogram
        ? {
            max: histogram.max / 1e6,
            mean: histogram.mean / 1e6,
            p50: histogram.percentile(50) / 1e6,
            p99: histogram.percentile(99) / 1e6,
            count: histogram.count,
          }
        : null,
      resolutionMs: api.resolutionMs,
    }),
    reset: () => {
      histogram?.reset?.();
      api.heartbeatSamples.length = 0;
    },
  });

  api.registerGlobal('__LANTERNA_GC__', {
    read: () => gcEvents.slice(),
    clear: () => {
      gcEvents.length = 0;
    },
  });
}
