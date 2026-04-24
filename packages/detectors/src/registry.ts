import {
  createCpuProfileKind,
  createKindRegistry,
  type ProfileKind,
  type ProfileKindRegistry,
} from '@lanterna-profiler/core';

export interface DefaultKindRegistryOptions {
  /** Supplies captured stderr to the CPU kind (needed for `--deep` deopt parsing). */
  readStderrSoFar?: () => string;
  /** Additional kinds to register alongside CPU. */
  extra?: ProfileKind[];
}

/**
 * Builds a {@link ProfileKindRegistry} containing the built-in CPU kind plus
 * any extra kinds passed in. The CLI uses this to resolve `--kind <id>` flags.
 */
export function createDefaultKindRegistry(
  options: DefaultKindRegistryOptions = {},
): ProfileKindRegistry {
  const cpuKind = createCpuProfileKind({
    readStderrSoFar: options.readStderrSoFar ?? (() => ''),
  });
  return createKindRegistry([cpuKind, ...(options.extra ?? [])]);
}
