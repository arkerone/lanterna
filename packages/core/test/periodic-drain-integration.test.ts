import { describe, expect, it } from 'vitest';
import { runCapture } from '../src/capture/coordinator.js';
import { createInProcessSource } from '../src/capture/in-process.js';

// Real end-to-end coverage for the periodic mid-capture drain (attach/
// in-process mode): drives an actual in-process CDP session with a short
// `periodicDrainIntervalMs` so multiple real drain ticks happen during the
// capture, and asserts the drained event-loop samples span the whole window
// instead of only whatever the final read would have seen. `PeriodicSignalDrain`
// itself (accumulation, tick-skipping, stop-quiescence, timeout diagnostics)
// is covered at the unit level in periodic-signal-drain.test.ts against a
// fake CDP that can simulate a target dying mid-capture; this test exists to
// prove the real coordinator/hook wiring behind it actually works.
async function burnCpuUntil(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    let x = 0;
    for (let i = 0; i < 200_000; i++) x += Math.sqrt(i);
    if (x < 0) throw new Error('unreachable');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('runCapture — periodic mid-capture drain (in-process)', () => {
  it('drains event-loop samples across multiple ticks spanning the whole capture', async () => {
    const durationMs = 900;
    const [bundle] = await Promise.all([
      runCapture({
        source: await createInProcessSource(),
        sourceOptions: {},
        kinds: [],
        durationMs,
        periodicDrainIntervalMs: 150,
      }),
      burnCpuUntil(Date.now() + durationMs + 100),
    ]);

    expect(bundle.captureIntegrity.diagnostics?.filter((d) => d.stage === 'runtime-read')).toEqual(
      undefined,
    );
    expect(bundle.runtimeSignals.eventLoopAvailable).toBe(true);
    expect(bundle.runtimeSignals.eventLoopSamples.length).toBeGreaterThan(5);
    const lastSampleAtMs =
      bundle.runtimeSignals.eventLoopSamples[bundle.runtimeSignals.eventLoopSamples.length - 1]
        ?.atMs ?? 0;
    // If only the final (single) read had ever happened, this would still
    // pass — the real signal that periodic draining worked is that samples
    // exist from well before the end of the window too.
    const firstSampleAtMs = bundle.runtimeSignals.eventLoopSamples[0]?.atMs ?? durationMs;
    expect(firstSampleAtMs).toBeLessThan(durationMs / 2);
    expect(lastSampleAtMs).toBeGreaterThan(durationMs / 2);
  }, 20_000);
});
