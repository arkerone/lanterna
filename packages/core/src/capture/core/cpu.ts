import type { CdpClient } from '../../inspector/client.js';
import type { RawCpuProfile } from './types.js';

export async function startCpuMeasure(cdp: CdpClient, sampleIntervalMicros: number): Promise<void> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: sampleIntervalMicros });
  await cdp.send('Profiler.start');
}

export async function stopCpuMeasure(cdp: CdpClient): Promise<RawCpuProfile> {
  const res = await cdp.send<{ profile: RawCpuProfile }>('Profiler.stop');
  return res.profile;
}
