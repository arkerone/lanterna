<p align="center">
  <img src="assets/icon.png" alt="Lanterna" width="220" />
</p>

<h1 align="center">Lanterna</h1>

<p align="center">
  <strong>Agent-first Node.js CPU & memory profiler.</strong><br />
  Runs your program, captures a V8 profile plus timed runtime signals,<br />
  and emits a structured JSON report that humans <em>and</em> AI agents can act on directly.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lanterna-profiler/cli"><img src="https://img.shields.io/npm/v/@lanterna-profiler/cli.svg" alt="npm version" /></a>
  <img src="https://img.shields.io/node/v/@lanterna-profiler/cli.svg" alt="Node.js version" />
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
</p>

---

> [!NOTE]
> Lanterna is built so its output is **useful to an AI agent**, not just a human reader. Instead of a flamegraph, you get a categorized, correlated, and actionable `LanternaReport` - ready to pipe into an LLM or a CLI tool.

## Features

- **Two capture modes** - `lanterna run` to spawn & profile a command, `lanterna attach` to connect to a live process via the inspector.
- **Two profile kinds** - opt-in via `--kind`: `cpu` (V8 sampling profiler, default) and `memory` (V8 sampling heap profiler + `process.memoryUsage()` time series).
- **V8 CPU profile + timed signals** - CPU samples correlated with GC pauses, event-loop lag and stalls, optional deopt traces (`--deep`).
- **Heap allocation profile** - hot allocators by self/total bytes plus a continuous RSS / heapUsed / external / arrayBuffers series with linear growth slope.
- **Enriched `LanternaReport`** - categorized hotspots, hot call stacks, ratios, capture-integrity flags.
- **Built-in findings** - sync crypto, blocking I/O, CPU-bound user code, JSON on the hot path, dependency hotspots, excessive GC, event-loop stalls, deopt loops, module loading on the hot path, sustained memory growth, large allocators, off-heap buffer pressure, and cross-kind alloc-in-hot-path.
- **Actionable evidence** - each finding ships with file/line, severity, rationale, and remediation hints.
- **Agent-ready** - stable JSON schema, `skills/lanterna-profiler/` workflow for Claude Code.

## Requirements

| Environment | Minimum version | Why |
| --- | --- | --- |
| Node.js running Lanterna itself | `>= 22` | Current LTS lines (22, 24). `engines.node` is `>=22.0.0` on every `@lanterna-profiler/*` package. |
| Node.js running the **profiled program** | `>= 12` | Needs `monitorEventLoopDelay` (≥ 11.10) and `PerformanceObserver` with `gc` entries (≥ 11.13). Any active LTS works. |

The profiled target must run on Node.js with inspector support.

> [!IMPORTANT]
> Lanterna starts the target with `--inspect-brk=0` and a preload hook. If the inspector is unavailable, the run fails fast - it never silently falls back to a weaker mode.

## Packages

| Package | What it is |
| --- | --- |
| [`@lanterna-profiler/cli`](packages/cli) | The `lanterna` binary - spawn/attach, argument parsing, interactive picker, report output. |
| [`@lanterna-profiler/core`](packages/core) | Capture orchestration, profile kinds, analysis pipeline, report building, and `runProfile` / `attachProfile`. |
| [`@lanterna-profiler/detectors`](packages/detectors) | Default CPU detector pack, detector adapters, thresholds, and plugin helper types. |

External detectors are first-class: publish a plugin (ES module with a default-exported register function) and load it via `--detectors <spec>` or `.lanterna.json`. See [`@lanterna-profiler/detectors`](packages/detectors#writing-a-detector-plugin) for the contract and [`@lanterna-profiler/cli`](packages/cli#loading-external-detectors) for loading.

## Installation

```bash
# CLI binary
npm install -g @lanterna-profiler/cli
# or, without installing:
npx @lanterna-profiler/cli --help

# Programmatic orchestration
npm install @lanterna-profiler/core

# Default detector pack
npm install @lanterna-profiler/detectors
```

## Quick Start

```bash
# Profile CPU for 30s and write the JSON report to disk
lanterna run --duration 30s --output report.json -- node app.js
# or, without installing:
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js

# Profile memory only (heap allocations + RSS series)
lanterna run --kind memory --duration 30s --output report.json -- node app.js

# Profile CPU and memory together
lanterna run --kind cpu --kind memory --duration 30s --output report.json -- node app.js

# Attach to a running Node process
lanterna attach --pid 4242 --duration 15s --output report.json

# Inspect findings with jq
jq '.findings[] | select(.severity != "info") | {id, severity}' report.json
```

> [!TIP]
> `Ctrl+C` (or `SIGTERM`) stops profiling early **and still emits a final report**. In `run` mode it also terminates the spawned target; in `attach` mode the target keeps running.

## Usage

### Profile a command

```bash
lanterna run [options] -- <command> [args...]
```

Lanterna spawns the command with the inspector enabled, injects a preload hook to capture GC and event-loop signals, runs the V8 sampling profiler, and emits an enriched report when the duration expires or the child exits.

```bash
# Profile until the child exits, pretty-print
lanterna run --pretty -- node server.js

# Include V8 deopt tracing
lanterna run --duration 30s --deep -- node app.js
```

### Attach to a running process

```bash
lanterna attach [options]
```

Lanterna connects to an existing Node.js process over the Chrome DevTools Protocol, injects a runtime hook, and profiles for the requested duration (or until you stop it).

```bash
# By PID
lanterna attach --pid 4242 --duration 15s

# Interactive picker (TTY required)
lanterna attach --pid

# Directly to an existing inspector WebSocket
lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid>
```

> [!WARNING]
> `attach --pid` relies on `SIGUSR1` and is POSIX-only. On Windows, use `--inspect-url`. Attach mode does **not** support `--deep` - deopt tracing cannot be enabled on a process that is already running.

### Options

| Option | Description |
| --- | --- |
| `--duration <ms\|s\|m>` | Profile duration. Omit to run until the child/target exits. |
| `--output <path>` | Write JSON to a file instead of stdout. |
| `--pretty` | Pretty-print JSON with 2-space indentation. |
| `--deep` | Enable `--trace-deopt` (spawn mode only). |
| `--sample-interval <us>` | V8 CPU sampling interval in µs (default `1000`, min `50`). |
| `--kind <id>` | Profile kind to capture (default `cpu`). Repeatable or comma-separated. Built-in: `cpu`, `memory`. |
| `--heap-sample-interval <size>` | V8 heap sampling interval (memory kind). Accepts raw bytes or a KiB/MiB suffix: `524288`, `512KiB`, `1MiB`. Default `512KiB`, min `1KiB`. |
| `--memory-usage-interval <ms>` | `process.memoryUsage()` cadence in ms (memory kind, default `250`, min `10`). |
| `--include-memory-samples` | Include raw `process.memoryUsage()` samples in JSON output (memory kind). |
| `--heap-snapshot-analysis` | Capture start/end V8 heap snapshots and include retained-growth synthesis (memory kind, opt-in and heavy). |
| `--heap-snapshot-dir <dir>` | Directory for `.heapsnapshot` files when snapshot analysis is enabled. |
| `--pid [pid]` | Attach by PID, or open the interactive picker if no value. |
| `--inspect-url <url>` | Attach to an existing inspector WebSocket URL. |
| `--detectors <spec>` | Load an additional detector plugin (package name or path). Repeatable. |
| `-h, --help` | Show help. |

The `--` separator is required before the target command in `run` mode.

## The Report

Lanterna emits a `LanternaReport` (schema v2) with per-kind sections nested under `profiles.*`:

| Section | Purpose |
| --- | --- |
| `meta` | Capture metadata, mode, duration, successfully captured `profileKinds`, integrity flags. |
| `profiles.cpu.summary` | High-level CPU ratios (user / builtin / native / GC). |
| `profiles.cpu.hotspots` | Aggregated functions with self/total CPU + callers/callees. |
| `profiles.cpu.hotStacks` | Most frequent sampled stacks. |
| `profiles.cpu.gc` | Pause totals, counts, longest pause, correlated hotspots. |
| `profiles.cpu.eventLoop` | Lag stats, stalls, correlation candidates, signal quality. |
| `profiles.cpu.deopts` | V8 deoptimisation events (only with `--deep`). |
| `profiles.memory.summary` | Total sampled bytes, top allocator, and RSS / heapUsed / external / arrayBuffers series stats (start/end/min/max/mean/p95 + linear slope). |
| `profiles.memory.hotAllocators` | Frames ranked by `selfBytes` / `totalBytes`, with file/line and frame category. |
| `profiles.memory.memoryUsage` | Compact `process.memoryUsage()` metadata (`sampleCount`, first/last sample). Raw samples are included only with `--include-memory-samples`. |
| `profiles.memory.heapSnapshotAnalysis` | Optional start/end retained-growth summary when `--heap-snapshot-analysis` is enabled. Very large snapshots are skipped with a warning instead of being parsed unbounded. |
| `findings` | Actionable detector output (cross-kind, each tagged `profileKind`), sorted by severity. |

> [!NOTE]
> Schema **v2** (current) nests per-kind data under `profiles.<id>.*`. Built-in kinds are `cpu` (default) and `memory` (opt-in via `--kind memory`). Future kinds (async, ...) will land under their own keys. Select kinds via `--kind <id>` (repeatable).

**Read it in this order:** `profiles.cpu.summary.topCategory` → `findings[]` → top `profiles.cpu.hotspots` → `eventLoop` & `gc`. Full schema in [docs/reading-a-report.md](docs/reading-a-report.md).

<details>
<summary><strong>Example output</strong></summary>

```json
{
  "meta": {
    "durationMs": 30000,
    "mode": "spawn",
    "profileKinds": ["cpu"],
    "kinds": {
      "cpu": {
        "samplesTotal": 30000,
        "sampleIntervalMicros": 1000,
        "deep": false
      }
    },
    "captureIntegrity": {
      "controlChannel": true,
      "controlChannelExpected": true,
      "eventLoopTimed": true,
      "gcTimed": true,
      "gcObserverAvailable": true,
      "controlChannelWriteErrors": 0,
      "gcObserverSetupFailed": 0,
      "heartbeatDropped": 0,
      "kinds": {
        "cpu": { "samplesTimed": true }
      }
    }
  },
  "profiles": {
    "cpu": {
      "summary": {
        "onCpuRatio": 0.91,
        "userCodeRatio": 0.14,
        "builtinRatio": 0.31,
        "nativeRatio": 0.49,
        "gcRatio": 0.03,
        "topCategory": "native",
        "dominantBlockingKind": "sync-crypto"
      },
      "hotspots": [],
      "hotStacks": [],
      "gc": {},
      "eventLoop": {},
      "deopts": []
    }
  },
  "findings": []
}
```

</details>

## Findings

| Finding id | Category | Trigger |
| --- | --- | --- |
| `sync-crypto-on-hot-path` | `sync-crypto` | Sampled sync crypto frame with `totalPct >= 1`, optionally attributed to a user caller. |
| `blocking-io:<api>` | `blocking-io` | Sampled sync fs / child_process / zlib frame with meaningful CPU. |
| `json-on-hot-path:<api>` | `json-on-hot-path` | `JSON.parse` / `JSON.stringify` consuming meaningful CPU. |
| `node-modules-hotspot:<package>` | `node-modules-hotspot` | A dependency frame dominates meaningful CPU time. |
| `excessive-gc` | `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms`. |
| `event-loop-stall` | `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200`. |
| `deopt-loop:<function>` | `deopt-loop` | Same deoptimised function seen ≥ 5 times (`--deep`) and hot in the CPU profile. |
| `require-in-hot-path` | `require-in-hot-path` | Module loading functions sampled on the hot path. |
| `memory-growth:rss` / `memory-growth:heapUsed` | `memory-growth` | Sustained linear growth ≥ 1 MB/s (warning) or ≥ 5 MB/s (critical) over the capture window. |
| `large-allocator:<frame>` | `large-allocator` | A single frame accounts for ≥ 15 % of sampled allocations. |
| `external-buffer-pressure` | `external-buffer-pressure` | Mean `external` exceeds 0.5× `heapUsed` (and ≥ 32 MB absolute). |
| `alloc-in-hot-path:<frame>` | `alloc-in-hot-path` | Same frame is hot on CPU **and** in top allocators (requires `--kind cpu memory`). |

Builtin-backed findings include a `proofLevel` so consumers can distinguish direct callee evidence from caller attribution.

Lanterna is extensible: you can ship your own detectors as plugins. See [Extending Lanterna](#extending-lanterna) below.

## Querying a report with jq

```bash
# Critical and warning findings
jq '.findings[] | select(.severity != "info") | {id, severity, file: .evidence.file, line: .evidence.line}' report.json

# Top 5 hotspots
jq '.profiles.cpu.hotspots[:5] | .[] | {fn: .function, selfPct, totalPct, file}' report.json

# Top 5 hot allocators
jq '.profiles.memory.hotAllocators[:5] | .[] | {fn: .function, file, line, selfBytes, selfPct, totalPct}' report.json

# RSS growth slope (bytes per second)
jq '.profiles.memory.summary | {startMB: (.rss.startBytes/1048576), endMB: (.rss.endBytes/1048576), slopeBytesPerSec: .rss.slopeBytesPerSec}' report.json

# Event-loop summary
jq '{basis: .profiles.cpu.eventLoop.measurementBasis, confidence: .profiles.cpu.eventLoop.confidence, maxLagMs: .profiles.cpu.eventLoop.maxLagMs, p99LagMs: .profiles.cpu.eventLoop.p99LagMs}' report.json

# Memory findings only
jq '.findings[] | select(.profileKind == "memory") | {id, severity, file: .evidence.file}' report.json

# Capture integrity
jq '.meta.captureIntegrity' report.json
```

## Signal Quality & Limitations

> [!WARNING]
> A hotspot in `node_modules` or `node:builtin` is often a **symptom**. The real action item may be in the user-code caller that triggered it.

- The target must run under Node with inspector support.
- Passive CDP discovery scans `127.0.0.1:9229..9238`; use `--inspect-url` for other ports.
- Event-loop lag quality depends on both timed heartbeats and the event-loop histogram - Lanterna degrades and reports when either is missing.
- `--deep` is required for deopt findings; without it, `deopts[]` is empty by design.
- Low-load or short-lived captures can be valid, but produce weaker attribution and less representative ratios.

Exact integrity and degradation behavior: [docs/how-lanterna-works.md](docs/how-lanterna-works.md).

## Extending Lanterna

Lanterna accepts third-party detectors and profile kinds as plugins. A plugin module exposes any combination of:

- a `default` export — `LanternaDetectorPlugin`, called with the analysis pipeline so it can register analyzers,
- a named `kinds: ProfileKind[]` export — additional profile kinds registered before `--kind <id>` is resolved (so a single package can ship a brand-new kind and its detectors).

```ts
// @acme/lanterna-detectors-prisma/src/index.ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  type KindScopedDetector,
} from '@lanterna-profiler/core';
import type { LanternaDetectorPlugin } from '@lanterna-profiler/detectors';

const prismaHotspotDetector: KindScopedDetector<'cpu'> = {
  id: 'prisma-hotspot:client',
  kindIds: ['cpu'],
  detect({ cpu }) {
    /* read cpu.report.hotspots and cpu.view.hotspotAnalysis */
    return [];
  },
};

const register: LanternaDetectorPlugin = (pipeline) => {
  pipeline.register(createFindingAnalyzerFromKindScopedDetector(prismaHotspotDetector));
};
export default register;
```

Load plugins from the CLI with `--detectors <spec>` (repeatable) or via a `.lanterna.json` / `.lanterna.config.json` file at the working directory root:

```bash
lanterna run --detectors @acme/lanterna-detectors-prisma --detectors ./my-plugin.mjs -- node server.js
```

```json
{
  "detectors": [
    "@acme/lanterna-detectors-prisma",
    "./scripts/lanterna-plugin.mjs"
  ]
}
```

Config entries load first, then any flag-specified plugins. See [`@lanterna-profiler/detectors`](packages/detectors#writing-a-detector-plugin) for the plugin contract, exposed helpers (`buildAttributedFinding`, `resolveAttribution`, `buildAttributionEvidence`, `CpuHotspotContext`, `withBuiltInCpuDetectors`, `createCpuProfileKindWithBuiltInDetectors`), and the full list of built-in detectors you can use as templates.

## Programmatic API

<details>
<summary><strong>Profile orchestration + default detectors</strong></summary>

```ts
import {
  attachProfile,
  runProfile,
  type LanternaReport,
} from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

let diagnostics = '';
const report: LanternaReport = await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  pretty: true,
  onTargetDiagnosticChunk: (chunk) => {
    diagnostics += chunk;
  },
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => diagnostics,
      sampleIntervalMicros: 1000,
      deep: true,
    }),
  ],
});
```

- `runProfile(...)` - spawn a Node process, capture, analyze, return a `LanternaReport`.
- `attachProfile(...)` - attach to an existing inspector target and return a `LanternaReport`.
- `createKindRegistry([...])` - registry that resolves `--kind <id>` strings.
- `createCpuProfileKindWithBuiltInDetectors(opts)` - CPU `ProfileKind` pre-wired with the default detector pack (each kind owns its own probe/analysis options).
- `withBuiltInCpuDetectors(kind)` - composable form that adds the built-in pack to an already-built CPU kind.
- `DETECTOR_THRESHOLDS` - thresholds used by the built-in rules.

Both `runProfile` and `attachProfile` accept extension options so you can add analyzers or additional profile kinds without going through the CLI:

```ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  runProfile,
} from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  pretty: false,
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => '',
      sampleIntervalMicros: 1000,
      deep: false,
    }),
    // myMemoryKind,                              // add custom kinds here
  ],
  extraAnalyzers: [
    createFindingAnalyzerFromKindScopedDetector(myDetector),
    mySectionAnalyzer,
  ],
  setupPipeline: async (pipeline, ctx) => { /* full-control hook */ },
});
```

When you enable `deep: true`, also pass `onTargetDiagnosticChunk` and append chunks to the buffer read by `readStderrSoFar`; deopt parsing depends on those target diagnostics. Leave `deep: false` and return an empty string when you do not collect that stream.

</details>

<details>
<summary><strong>Headless / plugin (<code>@lanterna-profiler/core</code>)</strong></summary>

```ts
import {
  buildLanternaReport,
  createAnalysisPipeline,
  createCpuProfileKind,
  defineFindingAnalyzer,
  defineSectionAnalyzer,
  runCapture,
  serializeReport,
  SpawnSource,
  AttachSource,
  type CaptureBundle,
  type Finding,
  type Hotspot,
  type LanternaReport,
  type ProfileKind,
} from '@lanterna-profiler/core';
```

Use low-level core APIs when you want full control over capture and analysis. Compose your own `runCapture({ source, kinds, durationMs })` call (each kind closes over its options at construction — no global `probeOptions`), then feed the resulting `CaptureBundle` into a pipeline you built with `createAnalysisPipeline({ kinds })` plus `pipeline.register(defineFindingAnalyzer({...}))` / `defineSectionAnalyzer({...})`. For typed kind-scoped detectors, use `KindScopedDetector<K>` + `createFindingAnalyzerFromKindScopedDetector(detector)`.

</details>

## Documentation

- [docs/how-lanterna-works.md](docs/how-lanterna-works.md) - runtime flow, architecture, degradation modes
- [docs/reading-a-report.md](docs/reading-a-report.md) - how to interpret the JSON report
- [docs/troubleshooting.md](docs/troubleshooting.md) - common problems and fixes
- [skills/lanterna-profiler/SKILL.md](skills/lanterna-profiler/SKILL.md) - agent-oriented profiling workflow for Claude Code

<details>
<summary><strong>Repository layout</strong></summary>

```
packages/
  core/       @lanterna-profiler/core       - capture orchestration, profile kinds, analysis pipeline, report
  detectors/  @lanterna-profiler/detectors  - default detector pack, analyzer adapters, analyzeCapture
  cli/        @lanterna-profiler/cli        - `lanterna` binary, argument parsing, output, interactive picker
skills/
  lanterna-profiler/               - agent-oriented profiling workflow for Claude Code
```

Dependency direction: `cli → core`, `cli → detectors`, and `detectors → core`. `core` never imports `detectors`.

</details>

## Development

```bash
npm install
npm run build       # builds all three packages
npm test            # runs every package's vitest suite
```

Per-package work: `npm run build -w @lanterna-profiler/core`, `npm test -w @lanterna-profiler/cli`, etc.

Tests use Vitest and cover frame classification, hotspot aggregation, detector evidence attribution, and live profiling paths - including short-lived processes and real event-loop stall correlation.
