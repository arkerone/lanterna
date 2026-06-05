import { describe, expect, it, vi } from 'vitest';
import { startCpuMeasure, stopCpuMeasure } from '../src/capture/core/cpu.js';
import { startHeapSampling, stopHeapSampling } from '../src/capture/core/heap.js';
import type { CdpClient } from '../src/inspector/client.js';

function fakeCdp(responses: Record<string, unknown> = {}): {
  client: CdpClient;
  sent: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const client: CdpClient = {
    closed: false,
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      return responses[method];
    }) as CdpClient['send'],
    evaluate: async () => undefined,
    on: () => () => {},
    onClose: () => () => {},
    close: async () => {},
  };
  return { client, sent };
}

describe('cpu measure', () => {
  it('enables, sets the sampling interval, and starts the profiler in order', async () => {
    const { client, sent } = fakeCdp();
    await startCpuMeasure(client, 1500);
    expect(sent.map((s) => s.method)).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
    ]);
    expect(sent[1]?.params).toEqual({ interval: 1500 });
  });

  it('returns the profile from Profiler.stop', async () => {
    const profile = { nodes: [], startTime: 0, endTime: 1, samples: [], timeDeltas: [] };
    const { client, sent } = fakeCdp({ 'Profiler.stop': { profile } });
    const result = await stopCpuMeasure(client);
    expect(result).toBe(profile);
    expect(sent.map((s) => s.method)).toEqual(['Profiler.stop']);
  });
});

describe('heap sampling', () => {
  it('enables and starts sampling with the configured interval', async () => {
    const { client, sent } = fakeCdp();
    await startHeapSampling(client, 65536);
    expect(sent.map((s) => s.method)).toEqual([
      'HeapProfiler.enable',
      'HeapProfiler.startSampling',
    ]);
    expect(sent[1]?.params).toEqual({ samplingInterval: 65536 });
  });

  it('returns the profile from HeapProfiler.stopSampling', async () => {
    const profile = { head: {}, samples: [] };
    const { client } = fakeCdp({ 'HeapProfiler.stopSampling': { profile } });
    const result = await stopHeapSampling(client);
    expect(result).toBe(profile);
  });
});
