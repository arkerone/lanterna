import type { CaptureHandle, SpawnStartOptions } from './core/types.js';
import { SpawnSource } from './spawn/index.js';

export { SpawnSource } from './spawn/index.js';

/**
 * Spawns a new child process and starts a CPU profiling session on it.
 *
 * The profiler attaches via the Chrome DevTools Protocol before the child's
 * first event-loop tick, so no startup work is missed. Call
 * `handle.stop()` to end the session and retrieve the {@link RawCapture}.
 */
export async function startSpawnCapture(
  options: SpawnStartOptions,
): Promise<CaptureHandle> {
  return new SpawnSource().start(options);
}
