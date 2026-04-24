import { connectCdp } from '../inspector/client.js';
import { openInspectorForPid } from '../inspector/discovery.js';
import { createCaptureIntegrity } from './core/session.js';
import type {
  AttachStartOptions,
  ConnectedSource,
  PreloadContribution,
  ProfileSource,
} from './core/types.js';

interface InstallAttachRuntimeResult {
  installed?: boolean;
  reason?: string;
  capabilities?: {
    eventLoop?: boolean;
    gc?: boolean;
    lifecycle?: boolean;
  };
  integrity?: {
    controlChannelWriteErrors: number;
    gcObserverSetupFailed: number;
    heartbeatDropped: number;
  };
}

export class AttachSource implements ProfileSource<AttachStartOptions> {
  async connect(
    options: AttachStartOptions,
    preload: PreloadContribution,
  ): Promise<ConnectedSource> {
    options.onProgress?.({
      stage: 'resolve-target',
      message: options.inspectUrl
        ? 'Using the inspector endpoint provided via --inspect-url.'
        : `Resolving an attachable inspector endpoint for pid ${options.pid ?? 'unknown'}...`,
    });

    const webSocketDebuggerUrl =
      options.inspectUrl ??
      (await openInspectorForPid(options.pid ?? -1, (message) => {
        options.onProgress?.({ stage: 'inspector-ready', message });
      }));

    options.onProgress?.({
      stage: 'connect-cdp',
      message: 'Connecting to the Chrome DevTools Protocol endpoint...',
    });
    const cdp = await connectCdp(webSocketDebuggerUrl);

    options.onProgress?.({
      stage: 'install-hooks',
      message: 'Installing Lanterna runtime hooks on the target process...',
    });
    const hookResult = await installAttachRuntimeHook(cdp, preload.attachScript);

    const captureIntegrity = createCaptureIntegrity({
      controlChannelExpected: false,
      gcObserverAvailable: Boolean(hookResult.capabilities?.gc),
      ...(hookResult.integrity ?? {}),
    });

    let exitSignaled = false;
    let resolveExit = () => {};
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });

    const signalExit = () => {
      if (exitSignaled) return;
      exitSignaled = true;
      resolveExit();
    };
    const detachRuntimeHandler = cdp.on('Runtime.executionContextsCleared', signalExit);
    const detachContextHandler = cdp.on('Runtime.executionContextDestroyed', signalExit);
    const detachCloseHandler = cdp.onClose(signalExit);

    return {
      cdp,
      target: {
        pid: options.pid ?? -1,
        nodeVersion: '',
        v8Version: '',
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
      },
      startedAtEpoch: Date.now(),
      initialIntegrity: captureIntegrity,
      waitForExit: async () => {
        await exitPromise;
      },
      finalize: async () => {
        detachRuntimeHandler();
        detachContextHandler();
        detachCloseHandler();
      },
    };
  }
}

async function installAttachRuntimeHook(
  cdp: import('../inspector/client.js').CdpClient,
  attachScript: string,
): Promise<InstallAttachRuntimeResult> {
  const value = await cdp.evaluate(attachScript);
  const result = (value ?? {}) as InstallAttachRuntimeResult;
  if (result.installed) return result;
  throw new Error(
    result.reason
      ? `failed to install attach runtime hook: ${result.reason}`
      : 'failed to install attach runtime hook',
  );
}

export async function createAttachSource(): Promise<AttachSource> {
  return new AttachSource();
}
