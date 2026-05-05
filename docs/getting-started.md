# Getting Started

This page walks you from zero to a useful Lanterna report in a few minutes. Once you are comfortable, the rest of [`docs/`](.) is reference material.

## Install

```bash
# CLI binary
npm install -g @lanterna-profiler/cli
# or, without installing
npx -y @lanterna-profiler/cli --help
```

You only need the CLI to capture and read reports. The other packages (`@lanterna-profiler/core`, `@lanterna-profiler/detectors`) are for programmatic use — see [programmatic-api.md](./programmatic-api.md).

### Requirements

| Environment | Minimum | Why |
| --- | --- | --- |
| Node.js running Lanterna | `>= 22` | Active LTS lines (22, 24). |
| Node.js running the **profiled program** | `>= 12` | Needs `monitorEventLoopDelay` and `PerformanceObserver` GC entries. |

The target must support the V8 inspector. If the inspector cannot start, Lanterna fails fast — it never silently falls back to a weaker mode.

## Capture your first profile

### Spawn the program (`lanterna run`)

```bash
lanterna run --duration 30s --output report.json -- node app.js
```

`--` separates Lanterna's flags from the target command. Lanterna spawns the program with the inspector enabled, runs the V8 sampling profiler for 30 s, then writes a `LanternaReport` to `report.json`.

### Profile a server with representative load

A server profiled without traffic mostly captures idle time. Use `--wait-for-url` to delay capture until the server is ready, and `--workload` to drive traffic during capture:

```bash
lanterna run \
  --duration 30s \
  --wait-for-url http://127.0.0.1:3000/health \
  --workload "npx -y autocannon http://127.0.0.1:3000" \
  --output report.json \
  -- node server.js
```

`--workload` is a shell command. Other common choices: `npx -y artillery run load.yml`, `npm run load`, `node scripts/load.mjs`.

### Attach to a running process (`lanterna attach`)

```bash
lanterna attach --pid 4242 --duration 15s --output report.json
```

Or open the interactive process picker:

```bash
lanterna attach --pid
```

`attach --pid` is POSIX-only. On Windows, start the target with `--inspect` yourself and use `--inspect-url ws://127.0.0.1:9229/<uuid>`.

## Read the report

The fastest first pass is the built-in renderer:

```bash
lanterna report report.json --format text
lanterna report report.json --format markdown --output report.md
```

For exact fields, use `jq`:

```bash
# Critical and warning findings
jq '.findings[] | select(.severity != "info") | {id, severity, file: .evidence.file, line: .evidence.line}' report.json

# CPU quality gate
jq '.profiles.cpu.quality' report.json
```

In what order should you read the JSON? See [reading-a-report.md](./reading-a-report.md). The schema itself is in [report-schema.md](./report-schema.md).

## Choose a profile kind

Lanterna captures one or more **profile kinds** in a single run. Built-in kinds:

| Kind | Default? | What you get |
| --- | --- | --- |
| `cpu` | yes | V8 sampling profiler, hotspots, hot stacks, GC pauses, event-loop lag — see [kinds/cpu.md](./kinds/cpu.md) |
| `memory` | opt-in | Heap allocation profile, RSS / heapUsed / external / arrayBuffers series, optional heap snapshots — see [kinds/memory.md](./kinds/memory.md) |
| `async` (experimental) | opt-in | Async resource lifecycle, awaits, concurrency — see [kinds/async.md](./kinds/async.md) |

Pick one or several with `--kind <id>` (repeatable or comma-separated):

```bash
lanterna run --kind memory --duration 30s -- node app.js
lanterna run --kind cpu --kind memory --duration 30s -- node app.js
lanterna run --kind cpu,memory --duration 30s -- node app.js
```

## Stop early, keep the report

`Ctrl+C` (or `SIGTERM`) stops profiling and **still writes a final report**. In `run` mode it also terminates the spawned target; in `attach` mode the target keeps running.

## Where to next

- All flags: [cli.md](./cli.md)
- Project-level config (`.lanterna.json`): [configuration.md](./configuration.md)
- Interpret your report: [reading-a-report.md](./reading-a-report.md)
- Map TypeScript/bundled frames back to source: [source-maps.md](./source-maps.md)
- Trouble? [troubleshooting.md](./troubleshooting.md)
- Plug in your own detectors: [extending/detectors.md](./extending/detectors.md)
