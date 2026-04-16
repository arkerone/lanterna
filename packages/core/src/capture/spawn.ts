import type { CaptureHandle, SpawnStartOptions } from './core/types.js';
import { SpawnSource } from './spawn/index.js';

export { SpawnSource } from './spawn/index.js';

export async function startSpawnCapture(
  options: SpawnStartOptions,
): Promise<CaptureHandle> {
  return new SpawnSource().start(options);
}
