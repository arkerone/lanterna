<p align="center">
  <img src="assets/icon.png" alt="Lanterna" width="220" />
</p>

<h1 align="center">Lanterna</h1>

<p align="center">
  <strong>Agent-first Node.js CPU profiler.</strong><br />
  Runs your program, captures a V8 profile plus timed runtime signals,<br />
  and emits a structured JSON report that humans <em>and</em> AI agents can act on directly.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/lanterna"><img src="https://img.shields.io/npm/v/lanterna.svg" alt="npm version" /></a>
  <img src="https://img.shields.io/node/v/lanterna.svg" alt="Node.js version" />
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
</p>

---

> [!NOTE]
> Lanterna is built so its output is **useful to an AI agent**, not just a human reader. Instead of a flamegraph, you get a categorized, correlated, and actionable `LanternaReport` - ready to pipe into an LLM or a CLI tool.

## Features

- **Two capture modes** - `lanterna run` to spawn & profile a command, `lanterna attach` to connect to a live process via the inspector.
- **V8 CPU profile + timed signals** - CPU samples correlated with GC pauses, event-loop lag and stalls, optional deopt traces (`--deep`).
- **Enriched `LanternaReport`** - categorized hotspots, hot call stacks, ratios, capture-integrity flags.
- **Built-in findings** - sync crypto, blocking I/O, CPU-bound user code, JSON on the hot path, dependency hotspots, excessive GC, event-loop stalls, deopt loops, module loading on the hot path.
- **Actionable evidence** - each finding ships with file/line, severity, rationale, and remediation hints.
- **Agent-ready** - stable JSON schema, `skills/lanterna-profile/` workflow for Claude Code.

## Requirements

| Environment | Minimum version | Why |
| --- | --- | --- |
| Node.js running Lanterna itself | `>= 20` | Runtime dependencies (`commander`, `ora`, `ps-list`) require Node 20+. |
| Node.js running the **profiled program** | `>= 12` | Needs `monitorEventLoopDelay` (≥ 11.10) and `PerformanceObserver` with `gc` entries (≥ 11.13). Any active LTS works. |

The profiled target must run on Node.js with inspector support.

> [!IMPORTANT]
> Lanterna starts the target with `--inspect-brk=0` and a preload hook. If the inspector is unavailable, the run fails fast - it never silently falls back to a weaker mode.

## Installation

```bash
npm install -g lanterna
# or, without installing:
npx lanterna --help
```

## Quick Start

```bash
# Profile for 30s and write the JSON report to disk
lanterna run --duration 30s --output report.json -- node app.js

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
| `--sample-interval <us>` | V8 sampling interval in µs (default `1000`, min `50`). |
| `--pid [pid]` | Attach by PID, or open the interactive picker if no value. |
| `--inspect-url <url>` | Attach to an existing inspector WebSocket URL. |
| `-h, --help` | Show help. |

The `--` separator is required before the target command in `run` mode.

## The Report

Lanterna emits a `LanternaReport` with the following top-level sections:

| Section | Purpose |
| --- | --- |
| `meta` | Capture metadata, mode, duration, integrity flags. |
| `summary` | High-level ratios (user / builtin / native / GC). |
| `hotspots` | Aggregated functions with self/total CPU + callers/callees. |
| `hotStacks` | Most frequent sampled stacks. |
| `gc` | Pause totals, counts, longest pause, correlated hotspots. |
| `eventLoop` | Lag stats, stalls, correlation candidates, signal quality. |
| `deopts` | V8 deoptimisation events (only with `--deep`). |
| `findings` | Actionable detector output, sorted by severity. |

**Read it in this order:** `summary.topCategory` → `findings[]` → top `hotspots` → `eventLoop` & `gc`. Full schema in [docs/reading-a-report.md](docs/reading-a-report.md).

<details>
<summary><strong>Example output</strong></summary>

```json
{
  "meta": {
    "durationMs": 30000,
    "sampleIntervalMicros": 1000,
    "mode": "spawn",
    "deep": false,
    "captureIntegrity": {
      "controlChannel": true,
      "eventLoopTimed": true,
      "gcTimed": true,
      "cpuSamplesTimed": true
    }
  },
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
  "deopts": [],
  "findings": []
}
```

</details>

## Findings

| Finding id | Category | Trigger |
| --- | --- | --- |
| `sync-crypto-on-hot-path` | `sync-crypto` | Sampled sync crypto frame with `totalPct >= 1`, optionally attributed to a user caller. |
| `blocking-io:<api>` | `blocking-io` | Sampled sync fs / child_process / zlib frame with meaningful CPU. |
| `cpu-bound-user-hotspot:<hotspot>` | `cpu-bound-user-hotspot` | Dominant user-code hotspot with no more specific match. |
| `json-on-hot-path:<api>` | `json-on-hot-path` | `JSON.parse` / `JSON.stringify` consuming meaningful CPU. |
| `node-modules-hotspot:<package>` | `node-modules-hotspot` | A dependency frame dominates meaningful CPU time. |
| `excessive-gc` | `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms`. |
| `event-loop-stall` | `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200`. |
| `deopt-loop:<function>` | `deopt-loop` | Same deoptimised function seen ≥ 5 times (`--deep`) and hot in the CPU profile. |
| `require-in-hot-path` | `require-in-hot-path` | Module loading functions sampled on the hot path. |

Builtin-backed findings include a `proofLevel` so consumers can distinguish direct callee evidence from caller attribution.

## Querying a report with jq

```bash
# Critical and warning findings
jq '.findings[] | select(.severity != "info") | {id, severity, file: .evidence.file, line: .evidence.line}' report.json

# Top 5 hotspots
jq '.hotspots[:5] | .[] | {fn: .functionName, selfPct, totalPct, file}' report.json

# Event-loop summary
jq '{basis: .eventLoop.measurementBasis, confidence: .eventLoop.confidence, maxLagMs: .eventLoop.maxLagMs, p99LagMs: .eventLoop.p99LagMs}' report.json

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

## Programmatic API

<details>
<summary><strong>Import surface</strong></summary>

```ts
import {
  analyzeCapture,
  runProfile,
  attachProfile,
  serializeReport,
  type LanternaReport,
} from 'lanterna';
import {
  createAnalysisPipeline,
  defineSectionAnalyzer,
  defineFindingAnalyzer,
} from 'lanterna/analysis';
import type { Finding, Hotspot } from 'lanterna/report';
```

Public entrypoints:

- `runProfile(...)` - spawn a Node process, capture, analyze, return a `LanternaReport`.
- `attachProfile(...)` - attach to an existing inspector target and return a `LanternaReport`.
- `analyzeCapture(...)` - turn a `RawCapture` into analysis output.
- `serializeReport(...)` - validate and serialize a final `LanternaReport`.
- `lanterna/analysis` - pipeline and analyzer registration helpers.
- `lanterna/report` - report types and serialization helpers.

Spawn/attach capture internals and in-process mode are **not** public.

</details>

## Documentation

- [docs/how-lanterna-works.md](docs/how-lanterna-works.md) - runtime flow, architecture, degradation modes
- [docs/reading-a-report.md](docs/reading-a-report.md) - how to interpret the JSON report
- [docs/troubleshooting.md](docs/troubleshooting.md) - common problems and fixes
- [skills/lanterna-profile/SKILL.md](skills/lanterna-profile/SKILL.md) - agent-oriented profiling workflow for Claude Code

<details>
<summary><strong>Source layout</strong></summary>

- `src/cli` - argument parsing, command dispatch, report output
- `src/profile.ts` - top-level orchestration for `runProfile` / `attachProfile`
- `src/capture` - raw capture session lifecycle and capture types
- `src/inspector` - CDP client, runtime metadata, inspector discovery
- `src/runtime-signals` - preload/runtime hook and timed signal readers
- `src/analysis/core` - pipeline orchestration, context, analyzer contracts
- `src/analysis/model` - frame classification, hotspot aggregation, correlations
- `src/analysis/detectors` - built-in findings
- `src/report` - report types, meta assembly, schema validation, serialization
- `src/shared` - cross-cutting utilities

</details>

## Development

```bash
npm install
npm run build
npm test
```

Tests use Vitest and cover frame classification, hotspot aggregation, detector evidence attribution, and live profiling paths - including short-lived processes and real event-loop stall correlation.
