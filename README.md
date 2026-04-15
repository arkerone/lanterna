<p align="center">
  <img src="assets/icon.png" alt="Lanterna icon" width="200" />
</p>

# Lanterna

> Agent-first Node.js CPU profiler. Lanterna runs your program, captures a V8 CPU profile plus timed runtime signals, and emits a structured JSON report that humans and agents can act on directly.

Lanterna is built for cases where a flamegraph is not enough or not the right interface.
Instead of producing a visualization for manual analysis, it produces an enriched `LanternaReport` with:

- categorized hotspots
- hot call stacks
- event-loop stall and GC correlation
- deoptimisation summaries
- actionable findings with evidence, rationale, and remediation hints

## What Lanterna Is For

Use Lanterna when you want to answer questions such as:

- Which function is actually consuming CPU in this Node.js process?
- Is the bottleneck in my code, a dependency, a Node builtin, native code, or GC?
- Are synchronous APIs blocking the event loop?
- Did GC pauses or event-loop stalls line up with specific user-code hotspots?
- Can I hand the result to an AI agent and get concrete optimisation work back?

Lanterna profiles Node.js processes either by starting them itself or by attaching to an already-running process over the Node inspector.

## Current Scope

Supported today:

- CLI command: `lanterna run`
- CLI command: `lanterna attach`
- capture modes: `spawn`, `attach`
- JSON output to stdout or file
- enriched findings for sync crypto, blocking I/O, CPU-bound user hotspots, JSON-on-hot-path, dependency hotspots, excessive GC, event-loop stalls, repeated deopts, and module loading on the hot path
- optional `--deep` mode for deopt tracing

Not implemented yet:

- in-process/programmatic capture API

The README and docs below describe the current implementation, not planned v2 modes.

## Requirements

- Node.js `>=20`
- a target command that ultimately runs on Node.js
- inspector support available in the target runtime

Lanterna starts the target with `--inspect-brk=0` and a preload hook. If inspector support is unavailable, the run fails fast.

## Quick Start

```bash
npm install -g lanterna

# Profile for 30 seconds and write the JSON report to disk
lanterna run --duration 30s --output report.json -- node app.js

# Emit compact JSON to stdout
lanterna run --duration 10s -- node server.js

# Pretty-print the report for manual reading
lanterna run --duration 10s --pretty -- node server.js

# Include V8 deoptimisation tracing
lanterna run --duration 30s --deep -- node app.js

# Attach to a long-running Node process by pid
lanterna attach --pid 4242 --duration 15s --output report.json

# Attach directly to an existing inspector WebSocket
lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --duration 15s --pretty
```

`--duration` accepts `ms`, `s`, or `m`. If omitted, Lanterna profiles until the child process exits.
For `attach`, `--duration` is required because Lanterna does not control the lifetime of the target process.

## CLI Reference

```text
lanterna run [options] -- <command> [args...]
lanterna attach [options]

Options:
  --duration <ms|s|m>     Profile duration. Omit to run until the child exits.
  --output <path>         Write JSON to a file instead of stdout
  --pretty                Pretty-print JSON with 2-space indentation
  --deep                  Enable --trace-deopt in the child process
  --sample-interval <us>  V8 sampling interval in microseconds (default: 1000)
  --pid <pid>             Attach to an existing Node.js pid
  --inspect-url <url>     Attach to an existing inspector WebSocket URL
  -h, --help              Show help
```

Important behavior:

- The `--` separator is required before the target command.
- `--deep` gives more signal for deopts, but it also makes the child process noisier because V8 deopt traces go to `stderr`.
- `--sample-interval` must be at least `50`.
- `lanterna attach` requires exactly one of `--pid` or `--inspect-url`.
- `lanterna attach` requires `--duration`.
- `lanterna attach` does not support `--deep`; attach mode cannot enable V8 deopt tracing on a process that is already running.

## What Happens During `lanterna attach`

At a high level:

1. Lanterna either signals the target pid with `SIGUSR1` and discovers the inspector on `127.0.0.1:9229`, or connects directly to the provided WebSocket URL.
2. It connects over the Chrome DevTools Protocol and reads target metadata such as Node version, V8 version, cwd, and pid.
3. It injects a lightweight runtime hook that starts event-loop heartbeats and GC tracking inside the existing process.
4. Lanterna starts the V8 sampling CPU profiler and waits for the requested duration.
5. At stop time, it reads timed runtime signals from the injected globals, stops the profiler, normalizes the capture, and emits the final enriched report.

Attach mode is intentionally conservative:

- `meta.command` is `[]` because Lanterna did not launch the process itself.
- `meta.captureIntegrity.controlChannel` is `false` by design because attach mode does not have the spawn-mode FD 3 control pipe.
- `deopts[]` remains empty because attach mode does not enable `--trace-deopt` on the target.

## What Happens During `lanterna run`

At a high level:

1. Lanterna spawns your command with `NODE_OPTIONS` extended to include `--inspect-brk=0` and a preload hook.
2. It waits for the inspector WebSocket, connects over the Chrome DevTools Protocol, and reads target metadata such as Node version, V8 version, cwd, and pid.
3. The preload hook starts publishing timed heartbeat events and GC events over a dedicated control channel.
4. Lanterna starts the V8 sampling CPU profiler, then releases the process with `Runtime.runIfWaitingForDebugger`.
5. When the requested duration expires, or when the child finishes, Lanterna stops profiling, reads the final event-loop summary, and normalizes the capture into a raw session.
6. The analysis pipeline classifies frames, aggregates hotspots, computes hot stacks, correlates user-code hotspots with GC and event-loop stall windows, runs detectors, and emits the final JSON report.

The detailed architecture and degradation modes are documented in [docs/how-lanterna-works.md](docs/how-lanterna-works.md).

## What You Get Back

Lanterna outputs a `LanternaReport` JSON object with these top-level sections:

- `meta`: capture metadata, command, duration, sample interval, mode, and integrity flags
- `summary`: high-level ratios such as user code vs builtin vs native vs GC
- `hotspots`: aggregated functions with self and total CPU, plus callers and callees
- `hotStacks`: most frequent sampled stacks
- `gc`: GC pause totals, counts, longest pause, and correlated hotspots
- `eventLoop`: lag statistics, stall intervals, correlation candidates, and signal quality
- `deopts`: grouped V8 deoptimisation events when `--deep` is enabled
- `findings`: actionable detector output sorted by severity and attributed CPU weight

Example shape:

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

For a field-by-field interpretation guide, see [docs/reading-a-report.md](docs/reading-a-report.md).

## How To Read the Report Quickly

Start with:

1. `summary.topCategory` and the ratio fields to understand where the process spends on-CPU time.
2. `findings[]` for the highest-priority actionable signals.
3. `hotspots[0..N]` to see where CPU is spent directly and transitively.
4. `eventLoop` and `gc` to understand latency and memory-pressure side effects.

Useful heuristics:

- High `builtinRatio` plus a `sync-crypto` or `blocking-io` finding usually means user code is calling a synchronous builtin on the hot path.
- High `idleRatio` usually means the process was not under enough load to make the profile representative.
- `eventLoop.available = true` is not enough on its own; also read `measurementBasis` and `confidence`.
- If `captureIntegrity.*` flags are degraded, treat correlation signals more cautiously.

## Findings Lanterna Emits Today

Lanterna currently ships these detectors:

| Finding id | Category | Current trigger |
| --- | --- | --- |
| `sync-crypto-on-hot-path` | `sync-crypto` | `pbkdf2Sync`, `scryptSync`, or `randomBytesSync` with `totalPct >= 1` |
| `blocking-io:<api>` | `blocking-io` | sync fs, child_process, or zlib APIs with meaningful `selfPct` or `totalPct` |
| `cpu-bound-user-hotspot:<hotspot>` | `cpu-bound-user-hotspot` | dominant user-code hotspot with no more specific detector match |
| `json-on-hot-path:<api>` | `json-on-hot-path` | `JSON.parse` or `JSON.stringify` consuming meaningful CPU on the hot path |
| `node-modules-hotspot:<package>` | `node-modules-hotspot` | a dependency frame dominates a meaningful share of CPU time |
| `excessive-gc` | `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms` |
| `event-loop-stall` | `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200` |
| `deopt-loop:<function>` | `deopt-loop` | same deoptimised function seen at least 5 times in `--deep` mode |
| `require-in-hot-path` | `require-in-hot-path` | module loading functions sampled on the hot path |

The exact evidence payload varies by detector. In particular, sync crypto, blocking I/O, JSON, dependency, GC, event-loop, and require findings may include correlated user-call-site attribution in `evidence.extra`.

## Quick jq Recipes

Useful one-liners for querying a report from the terminal:

```bash
# Show all critical and warning findings
jq '.findings[] | select(.severity != "info") | {id, severity, file: .evidence.file, line: .evidence.line}' report.json

# Top 5 hotspots by CPU
jq '.hotspots[:5] | .[] | {fn: .functionName, selfPct, totalPct, file}' report.json

# Event-loop summary
jq '{basis: .eventLoop.measurementBasis, confidence: .eventLoop.confidence, maxLagMs: .eventLoop.maxLagMs, p99LagMs: .eventLoop.p99LagMs}' report.json

# GC overview
jq '{gcRatio: .summary.gcRatio, longestPauseMs: .gc.longestPauseMs, pauseCount: (.gc.count.scavenge + .gc.count.markSweep)}' report.json

# Capture integrity flags
jq '.meta.captureIntegrity' report.json
```

## Signal Quality and Limitations

Lanterna does more than dump a raw `.cpuprofile`, but the output still needs to be read with an understanding of capture quality.

Current limitations:

- The target must run under Node with inspector support.
- `attach --pid` is POSIX-oriented because it relies on `SIGUSR1`; on Windows, use `--inspect-url`.
- `attach --pid` expects the inspector to become reachable on `127.0.0.1:9229`. If the target already uses a different inspector port, attach with `--inspect-url` instead.
- Event-loop lag is best when both timed heartbeats and the event-loop histogram are available. If either is missing, Lanterna degrades the signal and reports that fact.
- A hotspot in `node_modules` or `node:builtin` is often a symptom. The real action item may be in the user-code caller that triggered it.
- `--deep` is required for deopt findings; without it, `deopts[]` is empty by design.
- Low-load or short-lived captures can be valid, but they often produce weaker attribution and less representative ratios.

Read [docs/how-lanterna-works.md](docs/how-lanterna-works.md) for the exact integrity and degradation behavior.

## Programmatic Surface

Lanterna is still CLI-first, but it now exposes a cleaner programmatic split:

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

Recommended public entrypoints:

- `runProfile(...)`: spawn a Node process, capture it, analyze it, return a `LanternaReport`
- `attachProfile(...)`: attach to an existing Node inspector target and return a `LanternaReport`
- `analyzeCapture(...)`: turn a `RawCapture` into analysis output
- `serializeReport(...)`: validate and serialize a final `LanternaReport`
- `lanterna/analysis`: analysis pipeline and analyzer registration helpers
- `lanterna/report`: report types and report assembly/serialization helpers

Not public:

- spawn capture internals
- attach capture internals
- in-process capture mode

## Internal Structure

The source tree is organized by responsibility rather than by layered architecture:

- `src/cli`: argument parsing, command dispatch, report output
- `src/profile.ts`: top-level orchestration for `runProfile` and `attachProfile`
- `src/capture`: raw capture session lifecycle and capture types
- `src/inspector`: CDP client, runtime metadata access, inspector discovery
- `src/runtime-signals`: preload/runtime hook and timed signal readers
- `src/analysis/core`: analysis pipeline orchestration, context, analyzer contracts
- `src/analysis/model`: frame classification, hotspot aggregation, timed correlations, summaries
- `src/analysis/detectors`: built-in findings and detector helpers
- `src/report`: report types, meta assembly, schema validation, serialization
- `src/shared`: small cross-cutting utilities and constants

## Documentation

- [docs/how-lanterna-works.md](docs/how-lanterna-works.md): runtime flow, architecture, and degradation modes
- [docs/reading-a-report.md](docs/reading-a-report.md): how to interpret the JSON report
- [docs/troubleshooting.md](docs/troubleshooting.md): common problems and how to fix them
- [skills/lanterna-profile/SKILL.md](skills/lanterna-profile/SKILL.md): agent-oriented profiling workflow using Lanterna

## Development

```bash
npm install
npm run build
npm test
```

Tests use `node:test` and cover:

- frame classification
- hotspot aggregation
- detector behavior and evidence attribution
- live profiling paths, including short-lived processes and real event-loop stall correlation
