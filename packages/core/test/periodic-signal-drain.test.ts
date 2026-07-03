import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeriodicSignalDrain } from '../src/capture/coordinator/periodic-drain.js';
import { createCaptureIntegrity } from '../src/capture/core/session.js';
import type { CdpClient } from '../src/inspector/client.js';

class FakeCdp implements CdpClient {
  closed = false;
  evaluateCalls: string[] = [];
  eventLoopSamples: Array<{ atMs: number; lagMs: number }> = [];
  gcEvents: Array<{ atMs: number; kind: string; durationMs: number }> = [];
  hang = false;

  async send(): Promise<unknown> {
    return {};
  }

  async evaluate(expression: string): Promise<unknown> {
    this.evaluateCalls.push(expression);
    if (this.hang) return new Promise(() => {});
    if (expression.includes('__LANTERNA_EVENT_LOOP__')) {
      const drained = this.eventLoopSamples;
      this.eventLoopSamples = [];
      return drained;
    }
    if (expression.includes('__LANTERNA_GC__')) {
      const drained = this.gcEvents;
      this.gcEvents = [];
      return drained;
    }
    return null;
  }

  on(): () => void {
    return () => {};
  }

  onClose(): () => void {
    return () => {};
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeProbes(drainFn: () => Promise<void> = async () => {}) {
  const calls: number[] = [];
  return {
    calls,
    drain: async () => {
      calls.push(Date.now());
      await drainFn();
    },
  };
}

describe('PeriodicSignalDrain', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accumulates event-loop and GC samples across ticks', async () => {
    vi.useFakeTimers();
    const cdp = new FakeCdp();
    const captureIntegrity = createCaptureIntegrity();
    const probes = fakeProbes();
    const drain = new PeriodicSignalDrain(cdp, probes, captureIntegrity, 100);
    drain.start();

    cdp.eventLoopSamples = [{ atMs: 1, lagMs: 0 }];
    cdp.gcEvents = [{ atMs: 1, kind: 'scavenge', durationMs: 0.5 }];
    await vi.advanceTimersByTimeAsync(100);

    cdp.eventLoopSamples = [{ atMs: 2, lagMs: 1 }];
    cdp.gcEvents = [{ atMs: 2, kind: 'scavenge', durationMs: 0.3 }];
    await vi.advanceTimersByTimeAsync(100);

    await drain.stop();

    const accumulated = drain.accumulated();
    expect(accumulated.eventLoopSamplesAbs).toEqual([
      { atMs: 1, lagMs: 0 },
      { atMs: 2, lagMs: 1 },
    ]);
    expect(accumulated.gcEventsAbs).toEqual([
      { atMs: 1, kind: 'scavenge', durationMs: 0.5 },
      { atMs: 2, kind: 'scavenge', durationMs: 0.3 },
    ]);
    expect(probes.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('skips a tick while the previous one is still in flight', async () => {
    vi.useFakeTimers();
    const cdp = new FakeCdp();
    const captureIntegrity = createCaptureIntegrity();
    let resolveSlowDrain: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      resolveSlowDrain = resolve;
    });
    const probes = fakeProbes(() => slow);
    const drain = new PeriodicSignalDrain(cdp, probes, captureIntegrity, 50);
    drain.start();

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    // Only the first tick should have started — it's still awaiting `slow`.
    expect(probes.calls.length).toBe(1);

    resolveSlowDrain();
    await drain.stop();
  });

  it('stops scheduling once stopped and awaits the in-flight tick', async () => {
    vi.useFakeTimers();
    const cdp = new FakeCdp();
    const captureIntegrity = createCaptureIntegrity();
    const probes = fakeProbes();
    const drain = new PeriodicSignalDrain(cdp, probes, captureIntegrity, 50);
    drain.start();

    await vi.advanceTimersByTimeAsync(50);
    await drain.stop();
    const callsAfterStop = probes.calls.length;

    await vi.advanceTimersByTimeAsync(500);
    expect(probes.calls.length).toBe(callsAfterStop);
  });

  it('records a runtime-read diagnostic only once when reads keep timing out', async () => {
    vi.useFakeTimers();
    const cdp = new FakeCdp();
    cdp.hang = true;
    const captureIntegrity = createCaptureIntegrity();
    const probes = fakeProbes();
    // A short interval (100ms) with a much longer internal read timeout
    // (1500ms) means every attempt while the first tick is still hung gets
    // skipped by the in-flight guard — only one tick ever actually runs.
    const drain = new PeriodicSignalDrain(cdp, probes, captureIntegrity, 100);
    drain.start();

    // Single advance (not several sequential calls) so no fake-timer
    // callback is left pending when `stop()` awaits the in-flight tick —
    // `stop()` doesn't itself advance the fake clock.
    await vi.advanceTimersByTimeAsync(1600);
    await drain.stop();

    const stages = (captureIntegrity.diagnostics ?? []).map((d) => d.stage);
    expect(stages.filter((stage) => stage === 'runtime-read')).toEqual([
      'runtime-read',
      'runtime-read',
    ]);
  });

  it('never ticks after the CDP connection is closed', async () => {
    vi.useFakeTimers();
    const cdp = new FakeCdp();
    const captureIntegrity = createCaptureIntegrity();
    const probes = fakeProbes();
    const drain = new PeriodicSignalDrain(cdp, probes, captureIntegrity, 50);
    drain.start();
    cdp.closed = true;

    await vi.advanceTimersByTimeAsync(500);
    await drain.stop();

    expect(probes.calls.length).toBe(0);
  });
});
