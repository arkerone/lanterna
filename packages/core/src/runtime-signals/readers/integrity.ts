import type { CaptureIntegrity } from '../../capture/core/types.js';
import type { CdpClient } from '../../inspector/client.js';
import { runtimeIntegrityCountersSchema } from '../schemas.js';

export type RuntimeIntegrityCounters = Pick<
  CaptureIntegrity,
  'controlChannelWriteErrors' | 'gcObserverSetupFailed' | 'heartbeatDropped'
>;

const READ_RUNTIME_INTEGRITY_EXPRESSION = `(() => {
  return globalThis.__LANTERNA_ATTACH_RUNTIME__?.ensureInstalled?.().integrity ?? null;
})()`;

export async function readRuntimeIntegrity(
  cdp: Pick<CdpClient, 'evaluate' | 'closed'>,
): Promise<RuntimeIntegrityCounters | undefined> {
  if (cdp.closed) return undefined;
  try {
    const value = await cdp.evaluate(READ_RUNTIME_INTEGRITY_EXPRESSION);
    const parsed = runtimeIntegrityCountersSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
