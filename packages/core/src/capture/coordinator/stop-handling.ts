import type { RunCaptureOptions } from '../coordinator.js';
import type { ConnectedSource } from '../core/types.js';

export async function waitForStop<TOptions>(
  connected: ConnectedSource,
  options: RunCaptureOptions<TOptions>,
): Promise<'exit' | 'timeout' | 'signal'> {
  let timeout: NodeJS.Timeout | undefined;
  const promises: Array<Promise<'exit' | 'timeout' | 'signal'>> = [
    connected.waitForExit().then<'exit'>(() => 'exit'),
  ];
  if (options.durationMs !== undefined) {
    promises.push(
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), options.durationMs);
      }),
    );
  }
  if (options.stopSignal) {
    promises.push(options.stopSignal.then<'signal'>(() => 'signal'));
  }
  try {
    return await Promise.race(promises);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createManualStopSignal(): {
  trigger: () => void;
  promise: Promise<void>;
  abortSignal: AbortSignal;
} {
  const abortController = new AbortController();
  let trigger = () => {};
  const promise = new Promise<void>((resolve) => {
    trigger = () => {
      abortController.abort();
      resolve();
    };
  });
  return { trigger, promise, abortSignal: abortController.signal };
}
