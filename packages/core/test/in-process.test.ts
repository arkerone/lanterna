import { describe, expect, it } from 'vitest';
import { profileInProcess } from '../src/index.js';

// Burns CPU in small chunks, yielding between them so the event loop (and the
// in-process inspector message loop) keeps running during the capture.
async function burnCpuUntil(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    let x = 0;
    for (let i = 0; i < 2_000_000; i++) x += Math.sqrt(i);
    if (x < 0) throw new Error('unreachable');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('profileInProcess', () => {
  it('captures the current process and produces an in-process report', async () => {
    const durationMs = 700;
    const [report] = await Promise.all([
      profileInProcess({ durationMs }),
      burnCpuUntil(Date.now() + durationMs),
    ]);

    expect(report.meta.mode).toBe('in-process');
    expect(report.meta.profileKinds).toContain('cpu');
    expect(report.meta.command).toEqual([]);
    expect(report.profiles.cpu).toBeDefined();
    // In-process behaves like attach: no FD-3 control channel.
    expect(report.meta.captureIntegrity.controlChannel).toBe(false);
    expect(report.meta.captureIntegrity.controlChannelExpected).toBe(false);
    // The target is this very process.
    expect(report.meta.kinds.cpu).toBeDefined();
  });

  it('stops when an external AbortSignal fires', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = profileInProcess({ signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    const report = await pending;
    expect(report.meta.mode).toBe('in-process');
    // It stopped on the signal rather than hanging forever.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('requires durationMs or a signal to stop', async () => {
    await expect(profileInProcess({})).rejects.toThrow(/durationMs or an AbortSignal/);
  });
});
