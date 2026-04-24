import type { ProfileKind } from './types.js';

/**
 * Registry of available {@link ProfileKind}s. Resolves `--kind <id>` strings
 * from the CLI into the actual implementations driving capture + analysis.
 *
 * The registry owns no built-in kinds itself. Callers (core facades, CLI) must
 * register the kinds they want to support — typically via
 * `createDefaultKindRegistry()` in `@lanterna-profiler/core`.
 */
export class ProfileKindRegistry {
  private readonly kinds = new Map<string, ProfileKind>();

  register(kind: ProfileKind): this {
    if (this.kinds.has(kind.id)) {
      throw new Error(`duplicate profile kind id: ${kind.id}`);
    }
    this.kinds.set(kind.id, kind);
    return this;
  }

  has(id: string): boolean {
    return this.kinds.has(id);
  }

  get(id: string): ProfileKind | undefined {
    return this.kinds.get(id);
  }

  list(): ProfileKind[] {
    return [...this.kinds.values()];
  }

  ids(): string[] {
    return [...this.kinds.keys()];
  }

  resolveMany(ids: string[]): ProfileKind[] {
    const resolved: ProfileKind[] = [];
    const unknown: string[] = [];
    for (const id of ids) {
      const kind = this.kinds.get(id);
      if (kind) {
        resolved.push(kind);
      } else {
        unknown.push(id);
      }
    }
    if (unknown.length > 0) {
      const available = this.ids().sort().join(', ') || '(none)';
      throw new Error(
        `unknown profile kind(s): ${unknown.join(', ')}. Available kinds: ${available}`,
      );
    }
    return resolved;
  }
}

export function createKindRegistry(kinds: ProfileKind[] = []): ProfileKindRegistry {
  const registry = new ProfileKindRegistry();
  for (const kind of kinds) registry.register(kind);
  return registry;
}
