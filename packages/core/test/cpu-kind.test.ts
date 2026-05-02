import { describe, expect, it } from 'vitest';
import { createCpuProbe } from '../src/kinds/cpu/index.js';

describe('cpu probe lifecycle', () => {
  it('disables the profiler domain during dispose', async () => {
    const sent: string[] = [];
    const cdp = {
      closed: false,
      send: async (method: string) => {
        sent.push(method);
        return {};
      },
      evaluate: async () => undefined,
      on: () => () => {},
      onClose: () => () => {},
      close: async () => {},
    };

    const probe = createCpuProbe({
      sampleIntervalMicros: 1000,
      deep: false,
      readStderrSoFar: () => '',
    });

    await probe.dispose?.({
      cdp,
      mode: 'attach',
      kindId: 'cpu',
      stopSucceeded: true,
    });

    expect(sent).toEqual(['Profiler.disable']);
  });
});
