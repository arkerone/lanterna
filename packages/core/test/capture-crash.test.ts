import { describe, expect, it } from 'vitest';
import { runCapture } from '../src/capture/coordinator.js';
import { SpawnSource } from '../src/capture/spawn.js';

describe('runCapture — target crash', () => {
  it('records meta.targetCrash when the target throws an uncaught exception', async () => {
    const bundle = await runCapture({
      source: new SpawnSource(),
      sourceOptions: {
        command: ['node', '-e', "throw new Error('boom')"],
        traceDeopt: false,
      },
      kinds: [],
    });

    expect(bundle.targetCrash).toEqual({
      kind: 'uncaughtException',
      message: 'boom',
    });
    expect(bundle.targetExit?.code).not.toBe(0);
  }, 20_000);

  it('leaves targetCrash undefined for a clean exit', async () => {
    const bundle = await runCapture({
      source: new SpawnSource(),
      sourceOptions: {
        command: ['node', '-e', '0'],
        traceDeopt: false,
      },
      kinds: [],
    });

    expect(bundle.targetCrash).toBeUndefined();
  }, 20_000);
});
