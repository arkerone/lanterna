# CLI Reference

Complete reference for the `lanterna` binary shipped by [`@lanterna-profiler/cli`](../packages/cli). For an introduction, start with [getting-started.md](./getting-started.md). For project-level configuration via `.lanterna.json`, see [configuration.md](./configuration.md).

## Commands

| Command | Purpose |
| --- | --- |
| [`lanterna run`](#lanterna-run) | Spawn a Node program and profile it. |
| [`lanterna attach`](#lanterna-attach) | Connect to an already-running Node process. |
| [`lanterna report`](#lanterna-report) | Render an existing JSON report as text, markdown, agent markdown or reformatted JSON. |

The `--` separator is required before the target command in `run`. `attach` never takes `-- <command>`; it takes `--pid` or `--inspect-url` instead.

## `lanterna run`

```bash
lanterna run [options] -- <command> [args...]
```

Lanterna spawns the command with `--inspect-brk=0`, injects a preload hook to capture GC and event-loop signals, runs the configured profile kinds, and emits a report when the duration expires or the child exits.

```bash
# 30 s capture, write JSON to disk
lanterna run --duration 30s --output report.json -- node app.js

# Run until the child exits, pretty-print
lanterna run --pretty -- node script.js

# Markdown report after 30 s
lanterna run --duration 30s --format markdown --output report.md -- node app.js

# Agent report after 30 s
lanterna run --duration 30s --format agent --output report.agent.md -- node app.js

# Server: wait for readiness, drive load during capture
lanterna run \
  --duration 30s \
  --wait-for-url http://127.0.0.1:3000/health \
  --workload "npx -y autocannon http://127.0.0.1:3000" \
  --output report.json \
  -- node server.js

# Memory profile only
lanterna run --kind memory --duration 30s -- node app.js

# CPU + memory together
lanterna run --kind cpu,memory --duration 30s -- node app.js

# Experimental async profile
lanterna run --kind async --duration 30s -- node server.js

# Deep mode (CPU only, run-only): adds V8 deopt tracing
lanterna run --deep --duration 15s -- node app.js

# Disable source-map resolution
lanterna run --no-source-maps -- node dist/app.js
```

`--workload` is a shell command run from the same cwd and environment as Lanterna. It is intended for external traffic generators: `npx -y autocannon ...`, `npx -y artillery run load.yml`, `npm run load`, `node scripts/load.mjs`. Prefer `npx -y` for one-off tools so the workload cannot block on an install confirmation prompt. If the workload exits non-zero, Lanterna still writes the report and then returns an error, so automation can fail the run without losing the captured evidence.

## `lanterna attach`

```bash
lanterna attach [options]
```

Connects to an existing Node.js process over the Chrome DevTools Protocol, installs the runtime hook in-process, and profiles for the requested duration (or until you stop it with `Ctrl+C`).

```bash
# By PID
lanterna attach --pid 4242 --duration 15s

# Interactive process picker (TTY required)
lanterna attach --pid

# Directly to a known inspector WebSocket
lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid>

# Immediate agent report
lanterna attach --pid 4242 --duration 15s --format agent --output report.agent.md
```

Constraints:

- `attach --pid` relies on `SIGUSR1` and is **POSIX-only**. On Windows, use `--inspect-url`.
- Attach mode does **not** support `--deep` — V8 deopt tracing cannot be enabled on a process that has already started.
- `--kind async` works in attach mode but capture is partial: resources and code loaded before hook installation cannot be observed. See [kinds/async.md](./kinds/async.md).

## `lanterna report`

```bash
lanterna report <file> [options]
```

Reads an existing JSON `LanternaReport` and renders it. Capture commands default to `--format json`; `report` defaults to `--format text`. For agents, prefer capturing JSON first and then rendering the deterministic agent contract:

```bash
lanterna report report.json --format text
lanterna report report.json --format markdown --output report.md
lanterna report report.json --format agent --output report.agent.md
lanterna report report.json --format json --pretty
```

`--format agent` is a deterministic Markdown contract for automated analysis. It contains a signal gate, action queue, evidence pack, files to read first, decision rules, and rerun commands only when the captured signal is insufficient.

## Options

Options are grouped by purpose. Capture options apply to `run` and `attach` unless noted; output options apply to all three commands.

### Common capture

| Option | Description |
| --- | --- |
| `--duration <ms\|s\|m>` | Profile duration. Omit to run until the child/target exits. |
| `--kind <id>` | Profile kind to capture. Repeatable or comma-separated. Default `cpu`. Built-in: `cpu`, `memory`, `async` (experimental). |
| `--sample-interval <us>` | V8 CPU sampling interval in microseconds. Default `1000`, min `50`. |

### Run-only

| Option | Description |
| --- | --- |
| `--deep` | Enable `--trace-deopt`. Required for `deopts[]` and the `deopt-loop:*` finding. Spawn-only. |
| `--wait-for-url <url>` | Wait for the URL to respond `2xx` before capture starts. |
| `--wait-timeout <ms\|s\|m>` | Readiness timeout for `--wait-for-url`. Default `30s`. |
| `--capture-delay <ms\|s\|m>` | Extra delay after readiness before capture starts. |
| `--workload <command>` | Shell command run in parallel during capture. |

### Attach-only

| Option | Description |
| --- | --- |
| `--pid [pid]` | Attach by PID, or open the interactive picker if no value. |
| `--inspect-url <url>` | Attach to an existing inspector WebSocket URL. |

### Memory kind (`--kind memory`)

| Option | Description |
| --- | --- |
| `--heap-sample-interval <size>` | V8 heap sampling interval. Accepts raw bytes or a KiB/MiB suffix (`524288`, `512KiB`, `1MiB`). Default `512KiB`, min `1KiB`. |
| `--memory-usage-interval <ms>` | `process.memoryUsage()` cadence in ms. Default `250`, min `10`. |
| `--include-memory-samples` | Include raw `process.memoryUsage()` samples in the JSON report. |
| `--heap-snapshot-analysis` | Capture start/end V8 heap snapshots and include retained-growth synthesis. Heavy. |
| `--heap-snapshot-dir <dir>` | Directory for `.heapsnapshot` files. Default `.lanterna-heapsnapshots`. |

### Async kind (`--kind async`, experimental)

| Option | Description |
| --- | --- |
| `--async-max-events <n>` | Cap on retained async resource records. Default `50000`. |
| `--async-stack-depth <n>` | V8 async call-stack depth. Default `32`, max `64`. |
| `--async-include-microtasks` | Include `TickObject` / `Microtask` resources (very noisy). |
| `--async-concurrency-interval <ms>` | Concurrency timeline cadence in ms. Default `100`. |
| `--async-instrumentation <off\|safe\|full>` | Extra async instrumentation mode. `full` rewrites later-loaded `await` sites and is higher risk. Default `safe`. |

### Source maps

| Option | Description |
| --- | --- |
| `--no-source-maps` | Disable source-map resolution for captured frame positions. Source maps are enabled by default for `run` and `attach`; `report` only renders what is already present in the JSON. |

### Output

| Option | Description |
| --- | --- |
| `-o, --output <path>` | Write the selected output format to a file instead of stdout. |
| `--format <json\|text\|markdown\|agent>` | Output format. Capture commands default to `json`; `report` defaults to `text`. |
| `--pretty` | Pretty-print JSON with 2-space indentation. |

### Plugins

| Option | Description |
| --- | --- |
| `--detectors <spec>` | Load an additional detector plugin (package name or path). Repeatable. See [extending/plugin-loading.md](./extending/plugin-loading.md). |

### General

| Option | Description |
| --- | --- |
| `-h, --help` | Show help. |

## Behavior notes

- **`Ctrl+C` is safe.** A `SIGINT` or `SIGTERM` stops profiling early and still writes a final report. In `run` mode, the spawned target is terminated too; in `attach` mode the target keeps running.
- **Heap snapshot interaction with `Ctrl+C`.** When `--heap-snapshot-analysis` is active, stopping early skips the final snapshot so Lanterna exits promptly. Use `--duration` or let the target exit naturally when you need the start/end retained-growth comparison.
- **Unknown `--kind <id>`.** Capture fails before starting with `unknown profile kind(s): <ids>. Available kinds: cpu, memory, async`. Plugin packages can register additional kinds — see [extending/plugin-loading.md](./extending/plugin-loading.md).
- **Low-confidence CPU profile.** When `profiles.cpu.quality.confidence` is `low`, the CLI prints a warning and still writes the report. Treat that report as a lead and rerun under more representative load — see [signal-quality.md](./signal-quality.md).
