export interface RuntimeHookInstallOptions {
  resolutionMs?: number;
  controlFd?: number;
  emitLifecycle?: boolean;
}

interface AttachRuntimeResult {
  installed: boolean;
  reason?: string;
  capabilities?: {
    eventLoop: boolean;
    gc: boolean;
    lifecycle: boolean;
  };
  integrity: RuntimeIntegrityCounters;
  resolutionMs?: number;
}

interface RuntimeIntegrityCounters {
  controlChannelWriteErrors: number;
  gcObserverSetupFailed: number;
  heartbeatDropped: number;
}

interface PerfHooksBuiltin {
  PerformanceObserver?: typeof PerformanceObserver;
  performance?: typeof globalThis.performance;
  monitorEventLoopDelay?: (options: { resolution: number }) => {
    count: number;
    max: number;
    mean: number;
    percentile: (value: number) => number;
    reset?: () => void;
    enable?: () => void;
  };
}

interface FsBuiltin {
  writeSync?: (fd: number, data: string) => unknown;
}

declare global {
  var __LANTERNA_EVENT_LOOP__:
    | {
        markCaptureStart: () => void;
        read: () => {
          samples: Array<{ atMs: number; lagMs: number }>;
          summary: {
            max: number;
            mean: number;
            p50: number;
            p99: number;
            count: number;
          } | null;
          resolutionMs: number;
        };
        reset: () => void;
      }
    | undefined;
  var __LANTERNA_GC__:
    | {
        read: () => Array<{ atMs: number; kind: string; durationMs: number }>;
        clear: () => void;
      }
    | undefined;
  var __LANTERNA_ATTACH_RUNTIME__:
    | {
        ensureInstalled: () => AttachRuntimeResult;
      }
    | undefined;
}

export function installLanternaRuntimeHook(
  options: RuntimeHookInstallOptions = {},
): AttachRuntimeResult {
  const existing = globalThis.__LANTERNA_ATTACH_RUNTIME__;
  if (existing && typeof existing.ensureInstalled === 'function') {
    return existing.ensureInstalled();
  }

  const getBuiltin = <T extends object>(name: string): T | null => {
    const processWithBuiltins = process as typeof process & {
      getBuiltinModule?: (name: string) => unknown;
    };
    let builtin: unknown;
    if (typeof processWithBuiltins.getBuiltinModule === 'function') {
      builtin =
        processWithBuiltins.getBuiltinModule(name) ||
        processWithBuiltins.getBuiltinModule(`node:${name}`);
    } else if (typeof require === 'function') {
      builtin = require(`node:${name}`) as unknown;
    }
    return builtin && typeof builtin === 'object' ? (builtin as T) : null;
  };

  const perfHooks = getBuiltin<PerfHooksBuiltin>('perf_hooks');
  const fs =
    options.controlFd !== undefined && options.controlFd >= 0 ? getBuiltin<FsBuiltin>('fs') : null;
  const PerformanceObserverCtor = globalThis.PerformanceObserver || perfHooks?.PerformanceObserver;
  const performanceApi = globalThis.performance || perfHooks?.performance;
  const monitorEventLoopDelay = perfHooks?.monitorEventLoopDelay;
  const heartbeatResolutionMs = Number(options.resolutionMs) || 20;
  const emitLifecycle = Boolean(options.emitLifecycle);
  const controlFd = Number.isInteger(options.controlFd) ? Number(options.controlFd) : -1;

  const state = {
    heartbeatTimer: null as NodeJS.Timeout | null,
    nextExpectedHeartbeatMs: 0,
    heartbeatSamples: [] as Array<{ atMs: number; lagMs: number }>,
    gcEvents: [] as Array<{ atMs: number; kind: string; durationMs: number }>,
    histogram: null as {
      count: number;
      max: number;
      mean: number;
      percentile: (value: number) => number;
      reset?: () => void;
      enable?: () => void;
    } | null,
    gcObserver: null as PerformanceObserver | null,
    completionSent: false,
    completionHoldTimer: null as NodeJS.Timeout | null,
    integrity: {
      controlChannelWriteErrors: 0,
      gcObserverSetupFailed: 0,
      heartbeatDropped: 0,
    } as RuntimeIntegrityCounters,
  };

  if (!performanceApi) {
    return {
      installed: false,
      reason: 'performance API unavailable',
      integrity: { ...state.integrity },
    };
  }

  const readIntegrity = (): RuntimeIntegrityCounters => ({ ...state.integrity });

  const emit = (event: object) => {
    if (!fs || controlFd < 0) return false;
    if (typeof fs.writeSync !== 'function') return false;
    try {
      fs.writeSync(controlFd, `${JSON.stringify(event)}\n`);
      return true;
    } catch {
      // Control events are best-effort only.
      state.integrity.controlChannelWriteErrors += 1;
      return false;
    }
  };

  const relativeMs = (nowMs: number) => nowMs;

  const resetCaptureState = () => {
    state.heartbeatSamples.length = 0;
    state.gcEvents.length = 0;
    state.completionSent = false;
  };

  const stopHeartbeat = () => {
    if (state.heartbeatTimer) {
      clearTimeout(state.heartbeatTimer);
    }
    state.heartbeatTimer = null;
  };

  const scheduleHeartbeat = () => {
    state.heartbeatTimer = setTimeout(() => {
      state.heartbeatTimer = null;
      const now = performanceApi.now();
      const lagMs = Math.max(0, now - state.nextExpectedHeartbeatMs);
      const sample = { atMs: now, lagMs };
      state.heartbeatSamples.push(sample);
      const sent = emit({ type: 'heartbeat', ...sample });
      if (!sent && fs && controlFd >= 0) state.integrity.heartbeatDropped += 1;
      state.nextExpectedHeartbeatMs = now + heartbeatResolutionMs;
      scheduleHeartbeat();
    }, heartbeatResolutionMs);
    if (typeof state.heartbeatTimer?.unref === 'function') {
      state.heartbeatTimer.unref();
    }
  };

  const ensureHistogram = () => {
    if (state.histogram || typeof monitorEventLoopDelay !== 'function') return;
    try {
      const histogram = monitorEventLoopDelay({ resolution: heartbeatResolutionMs });
      histogram.enable?.();
      state.histogram = histogram;
    } catch {
      state.histogram = null;
    }
  };

  const ensureGcObserver = () => {
    if (state.gcObserver) return;
    if (typeof PerformanceObserverCtor !== 'function') {
      state.integrity.gcObserverSetupFailed += 1;
      return;
    }
    try {
      // Node.js GC entries carry a `detail.kind` field not present on the base PerformanceEntry type.
      type GcEntry = PerformanceEntry & { detail?: { kind?: number } };
      const observer = new PerformanceObserverCtor((list: { getEntries: () => GcEntry[] }) => {
        for (const entry of list.getEntries()) {
          const event = {
            atMs: entry.startTime,
            kind: entry.detail?.kind !== undefined ? gcKindName(entry.detail.kind) : 'other',
            durationMs: entry.duration,
          };
          state.gcEvents.push(event);
          emit({ type: 'gc', ...event });
        }
      });
      observer.observe({ entryTypes: ['gc'], buffered: false });
      state.gcObserver = observer;
    } catch {
      state.integrity.gcObserverSetupFailed += 1;
      state.gcObserver = null;
    }
  };

  const holdForProfilerShutdown = () => {
    if (state.completionHoldTimer) clearTimeout(state.completionHoldTimer);
    state.completionHoldTimer = setTimeout(() => {
      state.completionHoldTimer = null;
    }, 250);
  };

  const sendCompletion = (source: string, code?: number | null) => {
    if (state.completionSent) return;
    state.completionSent = true;
    emit({
      type: 'app-complete',
      atMs: relativeMs(performanceApi.now()),
      source,
      code: code ?? null,
      integrity: readIntegrity(),
    });
    holdForProfilerShutdown();
  };

  const startCapture = () => {
    resetCaptureState();
    state.histogram?.reset?.();
    stopHeartbeat();
    state.nextExpectedHeartbeatMs = performanceApi.now() + heartbeatResolutionMs;
    scheduleHeartbeat();
    emit({
      type: 'capture-start',
      atMs: 0,
      resolutionMs: heartbeatResolutionMs,
    });
  };

  const readEventLoop = () => ({
    samples: state.heartbeatSamples.slice(),
    summary: state.histogram
      ? {
          max: state.histogram.max / 1e6,
          mean: state.histogram.mean / 1e6,
          p50: state.histogram.percentile(50) / 1e6,
          p99: state.histogram.percentile(99) / 1e6,
          count: state.histogram.count,
        }
      : null,
    resolutionMs: heartbeatResolutionMs,
  });

  ensureHistogram();
  ensureGcObserver();

  globalThis.__LANTERNA_EVENT_LOOP__ = {
    markCaptureStart: startCapture,
    read: readEventLoop,
    reset() {
      state.histogram?.reset?.();
      resetCaptureState();
    },
  };

  globalThis.__LANTERNA_GC__ = {
    read() {
      return state.gcEvents.slice();
    },
    clear() {
      state.gcEvents.length = 0;
    },
  };

  globalThis.__LANTERNA_ATTACH_RUNTIME__ = {
    ensureInstalled() {
      return {
        installed: true,
        capabilities: {
          eventLoop: true,
          gc: Boolean(state.gcObserver),
          lifecycle: emitLifecycle,
        },
        integrity: readIntegrity(),
        resolutionMs: heartbeatResolutionMs,
      };
    },
  };

  emit({
    type: 'hook-ready',
    eventLoopResolutionMs: heartbeatResolutionMs,
    capabilities: {
      eventLoop: true,
      gc: Boolean(state.gcObserver),
      lifecycle: emitLifecycle,
    },
    integrity: readIntegrity(),
  });
  startCapture();

  if (emitLifecycle) {
    const originalExit = process.exit.bind(process);
    process.exit = function patchedExit(code?: number) {
      sendCompletion('process.exit', code);
      return originalExit(code);
    };

    process.once('beforeExit', (code) => {
      sendCompletion('beforeExit', code);
    });

    process.once('exit', (code) => {
      sendCompletion('exit', code);
    });

    process.once('uncaughtExceptionMonitor', (err) => {
      emit({
        type: 'crash',
        atMs: relativeMs(performanceApi.now()),
        kind: 'uncaughtException',
        message: String(err && typeof err === 'object' && 'message' in err ? err.message : err),
      });
    });

    process.once('unhandledRejection', (reason) => {
      emit({
        type: 'crash',
        atMs: relativeMs(performanceApi.now()),
        kind: 'unhandledRejection',
        message: String(reason),
      });
    });
  }

  return globalThis.__LANTERNA_ATTACH_RUNTIME__.ensureInstalled();

  function gcKindName(kind: number) {
    if (kind === 1) return 'scavenge';
    if (kind === 2) return 'markSweep';
    if (kind === 4) return 'incremental';
    return 'other';
  }
}

export function getAttachRuntimeHookSource(options: RuntimeHookInstallOptions = {}): string {
  return `(${installLanternaRuntimeHook.toString()})(${JSON.stringify(options)})`;
}

export function getPreloadHookSource(options: RuntimeHookInstallOptions = {}): string {
  return `'use strict';\n(${installLanternaRuntimeHook.toString()})(${JSON.stringify({
    ...options,
    controlFd: '__LANTERNA_CONTROL_FD__',
    emitLifecycle: true,
  }).replace('"__LANTERNA_CONTROL_FD__"', "Number(process.env.LANTERNA_CONTROL_FD || '-1')")});\n`;
}
