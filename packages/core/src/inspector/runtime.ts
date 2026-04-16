import type { TargetInfo } from '../capture/core/types.js';
import type { CdpClient } from './client.js';
import { targetInfoSchema } from '../runtime-signals/schemas.js';

const MARK_CAPTURE_START_EXPRESSION = 'globalThis.__LANTERNA_EVENT_LOOP__?.markCaptureStart?.()';
const READ_RUNTIME_CLOCK_EXPRESSION = 'performance.now()';
const READ_TARGET_INFO_EXPRESSION = `JSON.stringify({
  pid: process.pid,
  nodeVersion: process.version,
  v8Version: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  cwd: process.cwd()
})`;

export async function markCaptureStart(cdp: CdpClient): Promise<void> {
  await cdp.evaluate(MARK_CAPTURE_START_EXPRESSION);
}

export async function readRuntimeClockNow(cdp: CdpClient): Promise<number> {
  const value = await cdp.evaluate(READ_RUNTIME_CLOCK_EXPRESSION);
  return typeof value === 'number' ? value : 0;
}

export async function fetchTargetInfo(
  cdp: CdpClient,
  fallback: Partial<Pick<TargetInfo, 'pid'>> = {},
): Promise<TargetInfo> {
  await cdp.send('Runtime.enable');
  const value = await cdp.evaluate(READ_TARGET_INFO_EXPRESSION);
  if (typeof value !== 'string') {
    throw new Error('failed to read target metadata from runtime');
  }

  const parsedJson = JSON.parse(value) as unknown;
  const parsed = targetInfoSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error('target metadata returned an unexpected shape');
  }

  const pid = parsed.data.pid ?? fallback.pid;
  if (!pid) {
    throw new Error('target metadata is missing pid');
  }

  return {
    ...parsed.data,
    pid,
  };
}
