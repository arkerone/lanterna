# Loading Plugins

Lanterna plugins extend the CLI with extra detectors and/or extra profile kinds. This page covers how plugins are discovered, the order in which they load, and how to package one.

For authoring see:

- [detectors.md](./detectors.md) — write a finding detector.
- [profile-kinds.md](./profile-kinds.md) — write a brand-new profile kind.

## Plugin module shape

A plugin is an ES module with at least one of:

- a `default` export — `LanternaDetectorPlugin`, called with the analysis pipeline so it can register analyzers,
- a named `kinds: ProfileKind[]` export — additional profile kinds.

```ts
// @acme/lanterna-detectors-prisma/src/index.ts
import type { LanternaDetectorPlugin } from '@lanterna-profiler/detectors';
import type { ProfileKind } from '@lanterna-profiler/core';

const register: LanternaDetectorPlugin = (pipeline, ctx) => {
  pipeline.register(/* ... */);
};
export default register;

export const kinds: ProfileKind[] = [/* optional */];
```

## How the CLI discovers plugins

```bash
# From an installed package
lanterna run --detectors @acme/lanterna-detectors-prisma -- node app.js

# From a local file (relative to the current working directory)
lanterna run --detectors ./scripts/lanterna-plugin.mjs -- node app.js

# Multiple plugins — the flag is repeatable
lanterna run \
  --detectors @acme/lanterna-detectors-prisma \
  --detectors ./scripts/lanterna-plugin.mjs \
  -- node app.js
```

Plugins can also be listed in `.lanterna.json` at the working directory root:

```json
{
  "detectors": [
    "@acme/lanterna-detectors-prisma",
    "./scripts/lanterna-plugin.mjs"
  ]
}
```

See [configuration.md](../configuration.md) for the full config file reference.

## Resolution order

1. Built-in kinds (`cpu`, `memory`, `async`) are registered.
2. Plugins listed in `.lanterna.json` `detectors[]` are loaded — their `kinds` named exports are registered, then their default `setupPipeline` function is queued for the analysis pipeline.
3. Plugins from `--detectors` flags (in command-line order) are loaded the same way.
4. `--kind <id>` is resolved against the combined kind registry. Unknown ids fail before capture starts.

`detectors` entries are **additive**: config and CLI plugins both load. A plugin can therefore introduce a new kind that the user can immediately request via `--kind`.

## Packaging a plugin

A standalone npm package:

```jsonc
// package.json
{
  "name": "@acme/lanterna-detectors-prisma",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "peerDependencies": {
    "@lanterna-profiler/core": "^2.0.0",
    "@lanterna-profiler/detectors": "^2.0.1"
  }
}
```

Conventions:

- **Use `peerDependencies`** for `@lanterna-profiler/core` and `@lanterna-profiler/detectors` so consumers control the version.
- **Match the plugin name pattern** that fits the contribution: `lanterna-detectors-*` for detector packs, `lanterna-kinds-*` for new kinds, both names are fine for hybrid plugins.
- **Keep side-effect-free imports.** The plugin is loaded into the CLI process; an import that opens a connection or starts a server is a foot-gun.
- **Type-export your detector descriptors** (`KindScopedDetector<...>`) so downstream consumers can reuse them without the plugin envelope.

## Failure modes

- **Module not found.** The CLI exits with the resolution error. Local paths must be relative to the current working directory.
- **Module loads but exports neither `default` nor non-empty `kinds`.** The CLI rejects the plugin with `detector plugin "<spec>" must export default function(pipeline, ctx) and/or named "kinds: ProfileKind[]"`.
- **`kinds` collision.** A plugin registering a kind id or report section key already in the registry fails fast. Pick a unique id and `reportSectionKey` (e.g. `fs-acme`).
- **Detector throws during pipeline run.** The pipeline isolates failures: the detector's findings are dropped for that run, but other detectors and the report itself are unaffected. The error is logged.

## See also

- [detectors.md](./detectors.md) — author a detector.
- [profile-kinds.md](./profile-kinds.md) — author a kind.
- [../configuration.md](../configuration.md) — pin plugins per-project via `.lanterna.json`.
- [../programmatic-api.md](../programmatic-api.md) — register analyzers directly without packaging a plugin.
