export const ATTACH_RUNTIME_HOOK_SOURCE = String.raw`(() => {
  const existing = globalThis.__LANTERNA_ATTACH_RUNTIME__;
  if (existing && typeof existing.ensureInstalled === 'function') {
    return existing.ensureInstalled();
  }

  const getBuiltin = (name) => {
    if (typeof process.getBuiltinModule === 'function') {
      return process.getBuiltinModule(name) || process.getBuiltinModule('node:' + name);
    }
    if (typeof require === 'function') {
      return require('node:' + name);
    }
    return null;
  };

  const perfHooks = getBuiltin('perf_hooks');
  const PerformanceObserverCtor = globalThis.PerformanceObserver || perfHooks?.PerformanceObserver;
  const performanceApi = globalThis.performance || perfHooks?.performance;
  const monitorEventLoopDelay = perfHooks?.monitorEventLoopDelay;
  const HEARTBEAT_RESOLUTION_MS = 20;

  if (!performanceApi) {
    return { installed: false, reason: 'performance API unavailable' };
  }

  const state = {
    heartbeatTimer: null,
    nextExpectedHeartbeatMs: 0,
    heartbeatSamples: [],
    gcEvents: [],
    histogram: null,
    gcObserver: null,
  };

  const resetCaptureState = () => {
    state.heartbeatSamples.length = 0;
    state.gcEvents.length = 0;
  };

  const stopHeartbeat = () => {
    if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
    state.heartbeatTimer = null;
  };

  const scheduleHeartbeat = () => {
    state.heartbeatTimer = setTimeout(() => {
      state.heartbeatTimer = null;
      const now = performanceApi.now();
      const lagMs = Math.max(0, now - state.nextExpectedHeartbeatMs);
      state.heartbeatSamples.push({ atMs: now, lagMs });
      state.nextExpectedHeartbeatMs = now + HEARTBEAT_RESOLUTION_MS;
      scheduleHeartbeat();
    }, HEARTBEAT_RESOLUTION_MS);
    if (typeof state.heartbeatTimer?.unref === 'function') state.heartbeatTimer.unref();
  };

  const ensureHistogram = () => {
    if (state.histogram || typeof monitorEventLoopDelay !== 'function') return;
    try {
      state.histogram = monitorEventLoopDelay({ resolution: HEARTBEAT_RESOLUTION_MS });
      state.histogram.enable();
    } catch {
      state.histogram = null;
    }
  };

  const ensureGcObserver = () => {
    if (state.gcObserver || typeof PerformanceObserverCtor !== 'function') return;
    try {
      state.gcObserver = new PerformanceObserverCtor((list) => {
        for (const entry of list.getEntries()) {
          state.gcEvents.push({
            atMs: entry.startTime,
            kind: entry.detail && entry.detail.kind !== undefined ? gcKindName(entry.detail.kind) : 'other',
            durationMs: entry.duration,
          });
        }
      });
      state.gcObserver.observe({ entryTypes: ['gc'], buffered: false });
    } catch {
      state.gcObserver = null;
    }
  };

  const startCapture = () => {
    resetCaptureState();
    if (state.histogram && typeof state.histogram.reset === 'function') {
      state.histogram.reset();
    }
    stopHeartbeat();
    state.nextExpectedHeartbeatMs = performanceApi.now() + HEARTBEAT_RESOLUTION_MS;
    scheduleHeartbeat();
  };

  const readEventLoop = () => ({
    samples: state.heartbeatSamples.slice(),
    summary: state.histogram ? {
      max: state.histogram.max / 1e6,
      mean: state.histogram.mean / 1e6,
      p50: state.histogram.percentile(50) / 1e6,
      p99: state.histogram.percentile(99) / 1e6,
      count: state.histogram.count,
    } : null,
    resolutionMs: HEARTBEAT_RESOLUTION_MS,
  });

  const readGc = () => state.gcEvents.slice();

  ensureHistogram();
  ensureGcObserver();

  globalThis.__LANTERNA_EVENT_LOOP__ = {
    markCaptureStart: startCapture,
    read: readEventLoop,
    reset: resetCaptureState,
  };
  globalThis.__LANTERNA_GC__ = {
    read: readGc,
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
        },
        resolutionMs: HEARTBEAT_RESOLUTION_MS,
      };
    },
  };

  return globalThis.__LANTERNA_ATTACH_RUNTIME__.ensureInstalled();

  function gcKindName(kind) {
    if (kind === 1) return 'scavenge';
    if (kind === 2) return 'markSweep';
    if (kind === 4) return 'incremental';
    return 'other';
  }
})()`;
