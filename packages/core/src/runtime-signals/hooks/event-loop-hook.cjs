// Preload hook injected via --require by SpawnSource.
// Publishes timed event loop lag, GC pauses, and lifecycle events via a control FD.
'use strict';

const fs = require('node:fs');
const { PerformanceObserver, monitorEventLoopDelay, performance } = require('node:perf_hooks');

const HEARTBEAT_RESOLUTION_MS = 20;
const controlFd = Number(process.env.LANTERNA_CONTROL_FD || '-1');
const hasControlChannel = Number.isInteger(controlFd) && controlFd >= 0;

let completionSent = false;
let heartbeatTimer = null;
let nextExpectedHeartbeatMs = 0;
let completionHoldTimer = null;

const heartbeatSamples = [];
const gcEvents = [];

function emit(event) {
  if (!hasControlChannel) return;
  try {
    fs.writeSync(controlFd, `${JSON.stringify(event)}\n`);
  } catch {
    // Best-effort channel: the profiler can fall back to globals if needed.
  }
}

function relativeMs(nowMs) {
  return nowMs;
}

function resetCaptureState() {
  heartbeatSamples.length = 0;
  gcEvents.length = 0;
  completionSent = false;
}

function sendCompletion(source, code) {
  if (completionSent) return;
  completionSent = true;
  emit({
    type: 'app-complete',
    atMs: relativeMs(performance.now()),
    source,
    code: code ?? null,
  });
  holdForProfilerShutdown();
}

function holdForProfilerShutdown() {
  if (completionHoldTimer) clearTimeout(completionHoldTimer);
  completionHoldTimer = setTimeout(() => {
    completionHoldTimer = null;
  }, 250);
}

function scheduleHeartbeat() {
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    const now = performance.now();
    const lagMs = Math.max(0, now - nextExpectedHeartbeatMs);
    const sample = { atMs: relativeMs(now), lagMs };
    heartbeatSamples.push(sample);
    emit({ type: 'heartbeat', ...sample });
    nextExpectedHeartbeatMs = now + HEARTBEAT_RESOLUTION_MS;
    scheduleHeartbeat();
  }, HEARTBEAT_RESOLUTION_MS);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function startCapture() {
  resetCaptureState();
  nextExpectedHeartbeatMs = performance.now() + HEARTBEAT_RESOLUTION_MS;
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  scheduleHeartbeat();
  if (globalThis.__LANTERNA_EVENT_LOOP__) {
    globalThis.__LANTERNA_EVENT_LOOP__.reset();
  }
  emit({
    type: 'capture-start',
    atMs: 0,
    resolutionMs: HEARTBEAT_RESOLUTION_MS,
  });
}

emit({
  type: 'hook-ready',
  eventLoopResolutionMs: HEARTBEAT_RESOLUTION_MS,
  capabilities: { gc: true, eventLoop: true, lifecycle: true },
});
startCapture();

try {
  const histogram = monitorEventLoopDelay({ resolution: HEARTBEAT_RESOLUTION_MS });
  histogram.enable();
  globalThis.__LANTERNA_EVENT_LOOP__ = {
    markCaptureStart: startCapture,
    read() {
      return {
        samples: heartbeatSamples.slice(),
        summary: {
          max: histogram.max / 1e6,
          min: histogram.min / 1e6,
          mean: histogram.mean / 1e6,
          stddev: histogram.stddev / 1e6,
          p50: histogram.percentile(50) / 1e6,
          p99: histogram.percentile(99) / 1e6,
          count: histogram.count,
        },
        resolutionMs: HEARTBEAT_RESOLUTION_MS,
      };
    },
    reset() {
      histogram.reset();
      resetCaptureState();
    },
  };
} catch {
  globalThis.__LANTERNA_EVENT_LOOP__ = {
    markCaptureStart: startCapture,
    read() {
      return {
        samples: heartbeatSamples.slice(),
        summary: null,
        resolutionMs: HEARTBEAT_RESOLUTION_MS,
      };
    },
    reset: resetCaptureState,
  };
}

try {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const event = {
        atMs: entry.startTime,
        kind:
          entry.detail && entry.detail.kind !== undefined ? gcKindName(entry.detail.kind) : 'other',
        durationMs: entry.duration,
      };
      gcEvents.push(event);
      emit({ type: 'gc', ...event });
    }
  });
  observer.observe({ entryTypes: ['gc'], buffered: false });

  globalThis.__LANTERNA_GC__ = {
    read() {
      return gcEvents.slice();
    },
    clear() {
      gcEvents.length = 0;
    },
  };
} catch {
  globalThis.__LANTERNA_GC__ = null;
}

const originalExit = process.exit.bind(process);
process.exit = function patchedExit(code) {
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
    atMs: relativeMs(performance.now()),
    kind: 'uncaughtException',
    message: String(err && err.message ? err.message : err),
  });
});

process.once('unhandledRejection', (reason) => {
  emit({
    type: 'crash',
    atMs: relativeMs(performance.now()),
    kind: 'unhandledRejection',
    message: String(reason),
  });
});

function gcKindName(kind) {
  if (kind === 1) return 'scavenge';
  if (kind === 2) return 'markSweep';
  if (kind === 4) return 'incremental';
  return 'other';
}
