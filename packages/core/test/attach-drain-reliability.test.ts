import { type ChildProcess, spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AttachSource } from '../src/capture/attach.js';
import { runCapture } from '../src/capture/coordinator.js';

// Real-program reliability scenario for the periodic mid-capture drain
// (see PeriodicSignalDrain / docs/signal-quality.md "Periodic mid-capture
// drain"). Historically an attach capture only read the in-target
// event-loop/GC buffers once, at stop — a target that died mid-capture lost
// everything observed since the start. This spawns a real Node process with
// a real inspector, attaches to it like `lanterna attach` would, waits for
// several real drain ticks to happen, then kills the target (SIGKILL, no
// graceful shutdown) mid-capture and asserts the report still shows samples
// spanning most of the window instead of nothing.

function spawnInspectableTarget(): Promise<{ child: ChildProcess; inspectUrl: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--inspect=0',
        '-e',
        'setInterval(() => { let x = 0; for (let i = 0; i < 1e5; i++) x += i; }, 20);',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('timed out waiting for inspector URL'));
    }, 10_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      const match = /Debugger listening on (ws:\/\/\S+)/.exec(chunk.toString());
      if (match?.[1]) {
        settled = true;
        clearTimeout(timeout);
        resolve({ child, inspectUrl: match[1] });
      }
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });
}

describe('attach — periodic drain survives a real target being killed mid-capture', () => {
  it('still reports event-loop samples spanning most of the window after SIGKILL', async () => {
    const { child, inspectUrl } = await spawnInspectableTarget();
    try {
      const captureWindowMs = 2_000;
      const killAfterMs = 1_300; // after ~4 real drain ticks at 300ms

      const bundle = await runCapture({
        source: new AttachSource(),
        sourceOptions: { inspectUrl },
        kinds: [],
        durationMs: captureWindowMs,
        periodicDrainIntervalMs: 300,
        onCaptureStarted: () => {
          setTimeout(() => child.kill('SIGKILL'), killAfterMs);
        },
      });

      expect(bundle.runtimeSignals.eventLoopAvailable).toBe(true);
      const samples = bundle.runtimeSignals.eventLoopSamples;
      expect(samples.length).toBeGreaterThan(5);

      // If the periodic drain hadn't run, the only read would have been the
      // final one at stop — which, against a SIGKILL'd process, returns
      // nothing (the CDP connection is already dead). Seeing samples that
      // reach well past the kill point proves data survived the drain(s)
      // that happened *before* the kill.
      const lastSampleAtMs = samples[samples.length - 1]?.atMs ?? 0;
      expect(lastSampleAtMs).toBeGreaterThan(killAfterMs - 300);
    } finally {
      child.kill('SIGKILL');
    }
  }, 20_000);
});
