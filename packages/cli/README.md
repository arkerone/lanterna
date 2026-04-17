# @lanterna-profiler/cli

The `lanterna` command-line binary for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js CPU profiler.

Profile a Node process (spawn or attach), capture a V8 CPU profile plus runtime signals, run the built-in detectors, and emit a structured `LanternaReport` as JSON to stdout or a file.

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
lanterna run --pretty -- node script.js
```

### `lanterna attach`

```bash
lanterna attach [options]
```

Connects to an existing Node.js process over the Chrome DevTools Protocol and profiles for the requested duration (or until you stop it with `Ctrl+C`).

```bash
lanterna attach --pid 4242 --duration 15s
lanterna attach --pid                # interactive picker (TTY required)
lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid>
```

> `attach --pid` relies on `SIGUSR1` and is POSIX-only. On Windows, use `--inspect-url`. Attach mode does **not** support `--deep`.

### Options

| Option | Description |
| --- | --- |
| `--duration <ms\|s\|m>` | Profile duration. Omit to run until the child/target exits. |
| `--output <path>` | Write JSON to a file instead of stdout. |
| `--pretty` | Pretty-print JSON with 2-space indentation. |
| `--deep` | Enable `--trace-deopt` (run mode only). |
| `--sample-interval <us>` | V8 sampling interval in µs (default `1000`, min `50`). |
| `--pid [pid]` | Attach by PID, or open the interactive picker if no value. |
| `--inspect-url <url>` | Attach to an existing inspector WebSocket URL. |
| `--detectors <spec>` | Load an additional detector plugin (package name or path). Repeatable. |
| `-h, --help` | Show help. |

The `--` separator is required before the target command in `run` mode.

## Loading external detectors

Lanterna ships with a default detector pack, but any ES module with a `default` export matching the `LanternaDetectorPlugin` contract can be loaded alongside it.

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

The CLI is a thin wrapper around [`@lanterna-profiler/detectors`](../detectors) (which wraps [`@lanterna-profiler/core`](../core)). It adds:

- argument parsing (`commander`)
- interactive process picker (`@clack/prompts`, `ps-list`, `cli-table3`)
- progress indicator (`ora`, `chalk`)
- report output (stdout or file)

If you need programmatic access, prefer `runProfile` / `attachProfile` from `@lanterna-profiler/detectors`.

## Related packages

- [`@lanterna-profiler/core`](../core) - headless capture + pipeline primitives.
- [`@lanterna-profiler/detectors`](../detectors) - default detector pack + programmatic facades.
