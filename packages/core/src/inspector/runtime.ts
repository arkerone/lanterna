import type { TargetInfo } from '../capture/core/types.js';
import { targetInfoSchema } from '../runtime-signals/schemas.js';
import type { CdpClient } from './client.js';

const MARK_CAPTURE_START_EXPRESSION = 'globalThis.__LANTERNA_EVENT_LOOP__?.markCaptureStart?.()';
const READ_RUNTIME_CLOCK_EXPRESSION = 'performance.now()';
const DISPOSE_RUNTIME_EXPRESSION = 'globalThis.__LANTERNA_ATTACH_RUNTIME__?.dispose?.()';
const KEEPALIVE_EXPRESSION = 'globalThis.__LANTERNA_FRAMEWORK__?.keepalive?.()';
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

/**
 * Periodically pings the in-target hook framework so its liveness watchdog
 * knows the profiler is still driving the capture. If the pings stop (the
 * profiler was killed, the connection dropped), the framework disposes its
 * own instrumentation instead of observing the target forever.
 */
export function startRuntimeKeepalive(cdp: CdpClient, intervalMs: number): () => void {
  const timer = setInterval(() => {
    if (cdp.closed) return;
    cdp.evaluate(KEEPALIVE_EXPRESSION).catch(() => {
      // Best-effort: a failed ping just brings the watchdog closer to firing.
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export async function readRuntimeClockNow(cdp: CdpClient): Promise<number> {
  const value = await cdp.evaluate(READ_RUNTIME_CLOCK_EXPRESSION);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    // A wrong capture-start clock silently shifts every timed signal out of the
    // normalization window (all GC / event-loop samples get dropped) — fail
    // fast instead of degrading into an empty-signals report.
    throw new Error('failed to read the target runtime clock (performance.now())');
  }
  return value;
}

export async function disposeRuntime(cdp: CdpClient): Promise<void> {
  if (cdp.closed) return;
  let value: unknown;
  try {
    value = await cdp.evaluate(DISPOSE_RUNTIME_EXPRESSION);
  } catch (error) {
    // A target that already exited has no execution context left — there is
    // nothing to dispose, so this is not a diagnostic-worthy failure.
    if (isContextGoneError(error)) return;
    throw error;
  }
  const errors = (value as { errors?: unknown } | null | undefined)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`runtime dispose failed: ${errors.map(String).join('; ')}`);
  }
}

function isContextGoneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot find context|execution context was destroyed|target closed/i.test(message);
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
