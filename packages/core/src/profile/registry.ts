import { createKindRegistry, type ProfileKindRegistry } from '../kinds/core/registry.js';
import type { ProfileKind } from '../kinds/core/types.js';
import { createCpuProfileKind } from '../kinds/cpu/index.js';

export interface DefaultKindRegistryOptions {
  /** Supplies captured stderr to the CPU kind (needed for `--deep` deopt parsing). */
  readStderrSoFar?: () => string;
  /** Additional kinds to register alongside CPU. */
  extra?: ProfileKind[];
}

/**
 * Builds a ProfileKindRegistry containing the built-in CPU kind plus any
 * extra kinds passed in. Drivers use this to resolve `--kind <id>` flags.
 */
export function createDefaultKindRegistry(
  options: DefaultKindRegistryOptions = {},
): ProfileKindRegistry {
  const cpuKind = createCpuProfileKind({
    readStderrSoFar: options.readStderrSoFar ?? (() => ''),
  });
  return createKindRegistry([cpuKind, ...(options.extra ?? [])]);
}
