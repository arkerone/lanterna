import { connectInProcessCdp } from '../inspector/in-process-client.js';
import { installAttachRuntimeHook } from './attach.js';
import { createCaptureIntegrity } from './core/session.js';
import type {
  ConnectedSource,
  InProcessStartOptions,
  PreloadContribution,
  ProfileSource,
} from './core/types.js';

/**
 * Captures the **current** process by driving an in-process `node:inspector`
 * session — no child spawn, no remote attach. Shares the entire enrichment
 * pipeline with spawn/attach; like attach it installs runtime hooks via CDP
 * `evaluate` (no FD-3 control channel) and behaves as `attach`-mode for probes.
 *
 * `waitForExit` never resolves: the host process is the target and does not exit
 * during the capture, so the coordinator must be driven by `durationMs` or a
 * `stopSignal`. `finalize` is a no-op — Lanterna never terminates its own host.
 */
export class InProcessSource implements ProfileSource<InProcessStartOptions> {
  async connect(
    options: InProcessStartOptions,
    preload: PreloadContribution,
  ): Promise<ConnectedSource> {
    options.onProgress?.({
      stage: 'connect-cdp',
      message: 'Opening an in-process inspector session...',
    });
    const cdp = await connectInProcessCdp();

    options.onProgress?.({
      stage: 'install-hooks',
      message: 'Installing Lanterna runtime hooks in the current process...',
    });
    let hookResult: Awaited<ReturnType<typeof installAttachRuntimeHook>>;
    try {
      hookResult = await installAttachRuntimeHook(cdp, preload.attachScript);
    } catch (error) {
      await cdp.close().catch(() => {});
      throw error;
    }

    const captureIntegrity = createCaptureIntegrity({
      controlChannelExpected: false,
      gcObserverAvailable: Boolean(hookResult.capabilities?.gc),
      ...(hookResult.integrity ?? {}),
    });

    // The host process does not exit during capture; duration / stopSignal drive
    // the stop. A never-settling promise simply never wins the coordinator race.
    const exitPromise = new Promise<void>(() => {});

    return {
      cdp,
      target: {
        pid: process.pid,
        nodeVersion: process.version,
        v8Version: process.versions.v8,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
      },
      startedAtEpoch: Date.now(),
      initialIntegrity: captureIntegrity,
      waitForExit: () => exitPromise,
      finalize: async () => {
        // No-op: never terminate the host process.
      },
    };
  }
}

export async function createInProcessSource(): Promise<InProcessSource> {
  return new InProcessSource();
}
