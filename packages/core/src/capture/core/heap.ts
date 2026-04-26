import type { CdpClient } from '../../inspector/client.js';

export interface RawSamplingHeapProfileNode {
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  selfSize: number;
  id: number;
  children: RawSamplingHeapProfileNode[];
}

export interface RawSamplingHeapProfileSample {
  size: number;
  nodeId: number;
  ordinal: number;
}

export interface RawSamplingHeapProfile {
  head: RawSamplingHeapProfileNode;
  samples: RawSamplingHeapProfileSample[];
}

export async function startHeapSampling(
  cdp: CdpClient,
  samplingIntervalBytes: number,
): Promise<void> {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: samplingIntervalBytes });
}

export async function stopHeapSampling(cdp: CdpClient): Promise<RawSamplingHeapProfile> {
  const res = await cdp.send<{ profile: RawSamplingHeapProfile }>('HeapProfiler.stopSampling');
  return res.profile;
}
