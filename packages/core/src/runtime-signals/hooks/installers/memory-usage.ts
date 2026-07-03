import type { HookInstaller } from '../framework.js';

const DEFAULT_MEMORY_USAGE_INTERVAL_MS = 250;

/**
 * Builds the preload-hook fragment that periodically samples
 * `process.memoryUsage()` and exposes the series under
 * `globalThis.__LANTERNA_MEMORY__.read()` for CDP-side retrieval.
 *
 * The fragment is self-contained — it's serialized via Function.toString()
 * into the composed preload script.
 */
export function createMemoryUsageInstaller(
  options: { sampleIntervalMs?: number } = {},
): HookInstaller {
  const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_MEMORY_USAGE_INTERVAL_MS;
  return {
    id: 'memory-usage',
    source: `(${installMemoryUsage.toString()})(__lanterna, ${sampleIntervalMs});`,
  };
}

export interface MemoryUsageInstallerApi {
  performance: typeof globalThis.performance;
  controlChannel: { emit(event: object): boolean };
  integrity: { memoryUsageSamplesDropped: number };
  registerGlobal(name: string, value: unknown): void;
  addResetHook(fn: () => void): void;
  addDisposeHook?(fn: () => void): void;
  releaseInstaller?(id: string): void;
}

export function installMemoryUsage(api: MemoryUsageInstallerApi, sampleIntervalMs: number): void {
  // Capped (drop-oldest): this buffer lives inside the target process, so an
  // abandoned/very-long attach session must never grow the target heap
  // unboundedly. 20k samples ≈ 83 min at the 250ms default interval.
  const MEMORY_USAGE_SAMPLE_CAP = 20_000;
  const MEMORY_USAGE_SAMPLE_DROP_CHUNK = 200;
  const samples: Array<{
    atMs: number;
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  }> = [];
  let intervalMs = sampleIntervalMs;
  let captureStartMs = api.performance.now();
  let captureStarted = false;

  const sample = () => {
    try {
      const now = api.performance.now();
      const usage = process.memoryUsage();
      const entry = {
        atMs: Math.max(0, now - captureStartMs),
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers ?? 0,
      };
      if (samples.length >= MEMORY_USAGE_SAMPLE_CAP) {
        samples.splice(0, MEMORY_USAGE_SAMPLE_DROP_CHUNK);
        api.integrity.memoryUsageSamplesDropped += MEMORY_USAGE_SAMPLE_DROP_CHUNK;
      }
      samples.push(entry);
      api.controlChannel.emit({
        type: 'memory-usage',
        ...entry,
        sampleIntervalMs: intervalMs,
        captureStarted,
      });
    } catch {
      // process.memoryUsage() can throw in unusual hosts (e.g. workers without
      // full process surface). Drop the sample silently.
    }
  };

  // First sample immediately so the series starts at t≈0.
  sample();
  const timer = setInterval(sample, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  let disabled = false;

  api.addResetHook(() => {
    captureStartMs = api.performance.now();
    captureStarted = true;
    samples.length = 0;
    sample();
  });

  const disable = () => {
    if (disabled) return;
    disabled = true;
    clearInterval(timer);
    samples.length = 0;
    api.releaseInstaller?.('memory-usage');
  };

  api.addDisposeHook?.(disable);

  api.registerGlobal('__LANTERNA_MEMORY__', {
    read: () => ({
      samples: samples.slice(),
      sampleIntervalMs: intervalMs,
    }),
    // Periodic mid-capture drain (attach/in-process): empties the sample
    // buffer without resetting the capture-start clock the way `reset` does.
    drain: () => {
      const drained = samples.slice();
      samples.length = 0;
      return { samples: drained, sampleIntervalMs: intervalMs };
    },
    clear: () => {
      samples.length = 0;
    },
    disable,
    setIntervalMs: (next: number) => {
      if (Number.isFinite(next) && next > 0) intervalMs = next;
    },
  });
}
