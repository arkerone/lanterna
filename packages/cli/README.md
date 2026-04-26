# @lanterna-profiler/cli

The `lanterna` command-line binary for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js profiler.

Profile a Node process (spawn or attach), capture one or more profile kinds, run the built-in detectors, and emit a structured `LanternaReport` as JSON to stdout or a file.

> Schema v2: analysis output is grouped under `report.profiles.<kind>.*`. Today the built-in kind is `cpu`, so the CLI defaults to `--kind cpu` on both `run` and `attach`.

## Install

```bash
npm install -g @lanterna-profiler/cli
# or, without installing:
npx @lanterna-profiler/cli --help
```

## Commands

### `lanterna run`

```bash
lanterna run [options] -- <command> [args...]
```

Spawns the command with the inspector enabled, injects a preload hook, runs the V8 sampling profiler, and emits a report when the duration expires or the child exits.

```bash
lanterna run --duration 30s --output report.json -- node app.js
# or, without installing:
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js

lanterna run --deep --duration 15s -- node server.js
lanterna run --kind cpu --pretty -- node script.js
lanterna run --pretty -- node script.js
```

### `lanterna attach`

```bash
lanterna attach [options]
```

Connects to an existing Node.js process over the Chrome DevTools Protocol and profiles for the requested duration (or until you stop it with `Ctrl+C`).

```bash
lanterna attach --pid 4242 --duration 15s
lanterna attach --pid 4242 --kind cpu --duration 15s
lanterna attach --pid                # interactive picker (TTY required)
lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --kind cpu
```

> `attach --pid` relies on `SIGUSR1` and is POSIX-only. On Windows, use `--inspect-url`. Attach mode does **not** support `--deep`.

### Options

| Option | Description |
| --- | --- |
| `--duration <ms\|s\|m>` | Profile duration. Omit to run until the child/target exits. |
| `--output <path>` | Write JSON to a file instead of stdout. |
| `--pretty` | Pretty-print JSON with 2-space indentation. |
| `--deep` | Enable `--trace-deopt` (run mode only). |
| `--sample-interval <us>` | V8 CPU sampling interval in µs (default `1000`, min `50`). |
| `--kind <id>` | Profile kind to capture. Repeatable or comma-separated (default `cpu`). Built-in: `cpu`, `memory`. |
| `--heap-sample-interval <size>` | V8 heap sampling interval (memory kind). Accepts raw bytes or a KiB/MiB suffix: `524288`, `512KiB`, `1MiB`. Default `512KiB`, min `1KiB`. |
| `--memory-usage-interval <ms>` | `process.memoryUsage()` cadence in ms (memory kind only, default `250`, min `10`). |
| `--pid [pid]` | Attach by PID, or open the interactive picker if no value. |
| `--inspect-url <url>` | Attach to an existing inspector WebSocket URL. |
| `--detectors <spec>` | Load an additional detector plugin (package name or path). Repeatable. |
| `-h, --help` | Show help. |

The `--` separator is required before the target command in `run` mode.

`--kind` is supported on both `run` and `attach`. You can repeat the flag or use comma-separated shorthand such as `--kind cpu,memory`.

Built-in kinds:

- `cpu` (default): V8 sampling profiler. Produces `profiles.cpu.{summary,hotspots,hotStacks,gc,eventLoop,deopts}` and CPU detectors.
- `memory` (opt-in): V8 sampling heap profiler plus `process.memoryUsage()` time series. Produces `profiles.memory.{summary,hotAllocators,memoryUsage}` and memory detectors (`memory-growth`, `large-allocator`, `external-buffer-pressure`, `alloc-in-hot-path`).

Unknown kind ids fail before capture starts with:

```text
unknown profile kind(s): <ids>. Available kinds: cpu, memory
```

Plugin packages can register additional kinds via a named `kinds: ProfileKind[]` export.

## Loading external detectors

Lanterna ships with a default detector pack, but any ES module with a `default` export matching the `LanternaDetectorPlugin` contract can be loaded alongside it. A plugin module can also publish brand-new profile kinds via a named `kinds: ProfileKind[]` export — those kinds are registered before `--kind <id>` is resolved, so a plugin can ship both a kind and its detectors in one package.

```bash
# From an installed package
lanterna run --detectors @acme/lanterna-detectors-prisma -- node app.js

# From a local file (relative to the current working directory)
lanterna run --detectors ./scripts/lanterna-plugin.mjs -- node app.js

# Multiple plugins - the flag is repeatable
lanterna run \
  --detectors @acme/lanterna-detectors-prisma \
  --detectors ./scripts/lanterna-plugin.mjs \
  -- node app.js
```

A plugin module's named `kinds` and default `setupPipeline` are independently optional — at least one must be present. Combined, this means a single plugin package can register a new kind, attach its built-in detectors, and add cross-cutting analyzers without users wiring anything else.

You can also list detectors in a `.lanterna.json` (or `.lanterna.config.json`) file at the working directory root. Config entries load first, followed by any `--detectors` flags:

```json
{
  "detectors": [
    "@acme/lanterna-detectors-prisma",
    "./scripts/lanterna-plugin.mjs"
  ]
}
```

See [`@lanterna-profiler/detectors`](../detectors) for the plugin contract and helpers used to author detectors.

## What's inside

The CLI is a thin wrapper around [`@lanterna-profiler/core`](../core) for orchestration and [`@lanterna-profiler/detectors`](../detectors) for the built-in detector pack. It adds:

- argument parsing (`commander`)
- interactive process picker (`@clack/prompts`, `ps-list`, `cli-table3`)
- progress indicator (`ora`, `chalk`)
- report output (stdout or file)

If you need programmatic access, prefer `runProfile` / `attachProfile` from `@lanterna-profiler/core` and pass `createCpuProfileKindWithBuiltInDetectors(...)` from `@lanterna-profiler/detectors` when you want the default CPU rules.

## Related packages

- [`@lanterna-profiler/core`](../core) - capture orchestration, profile kinds, pipeline, and report APIs.
- [`@lanterna-profiler/detectors`](../detectors) - default detector pack and plugin helpers.
