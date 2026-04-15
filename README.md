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

Lanterna is currently focused on profiling a Node.js program that it starts itself.

## Current Scope

Supported today:

- CLI command: `lanterna run`
- collector mode: `spawn`
- JSON output to stdout or file
- enriched findings for sync crypto, blocking I/O, excessive GC, event-loop stalls, repeated deopts, and module loading on the hot path
- optional `--deep` mode for deopt tracing

Not implemented yet:

- attach to an existing PID
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
```

`--duration` accepts `ms`, `s`, or `m`. If omitted, Lanterna profiles until the child process exits.

## CLI Reference

```text
lanterna run [options] -- <command> [args...]

Options:
  --duration <ms|s|m>     Profile duration. Omit to run until the child exits.
  --output <path>         Write JSON to a file instead of stdout
  --pretty                Pretty-print JSON with 2-space indentation
  --deep                  Enable --trace-deopt in the child process
  --sample-interval <us>  V8 sampling interval in microseconds (default: 1000)
  -h, --help              Show help
```

Important behavior:

- The `--` separator is required before the target command.
- `--deep` gives more signal for deopts, but it also makes the child process noisier because V8 deopt traces go to `stderr`.
- `--sample-interval` must be at least `50`.

## What Happens During `lanterna run`

At a high level:

1. Lanterna spawns your command with `NODE_OPTIONS` extended to include `--inspect-brk=0` and a preload hook.
2. It waits for the inspector WebSocket, connects over the Chrome DevTools Protocol, and reads target metadata such as Node version, V8 version, cwd, and pid.
3. The preload hook starts publishing timed heartbeat events and GC events over a dedicated control channel.
4. Lanterna starts the V8 sampling CPU profiler, then releases the process with `Runtime.runIfWaitingForDebugger`.
5. When the requested duration expires, or when the child finishes, Lanterna stops profiling, reads the final event-loop summary, and normalizes the capture into a raw session.
6. The enricher classifies frames, aggregates hotspots, computes hot stacks, correlates user-code hotspots with GC and event-loop stall windows, runs detectors, and emits the final JSON report.

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
| `excessive-gc` | `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms` |
| `event-loop-stall` | `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200` |
| `deopt-loop:<function>` | `deopt-loop` | same deoptimised function seen at least 5 times in `--deep` mode |
| `require-in-hot-path` | `require-in-hot-path` | module loading functions sampled on the hot path |

The exact evidence payload varies by detector. In particular, sync crypto, blocking I/O, GC, and event-loop findings may include correlated user-call-site attribution in `evidence.extra`.

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

- Only spawn-mode collection is implemented.
- The target must run under Node with inspector support.
- Event-loop lag is best when both timed heartbeats and the event-loop histogram are available. If either is missing, Lanterna degrades the signal and reports that fact.
- A hotspot in `node_modules` or `node:builtin` is often a symptom. The real action item may be in the user-code caller that triggered it.
- `--deep` is required for deopt findings; without it, `deopts[]` is empty by design.
- Low-load or short-lived captures can be valid, but they often produce weaker attribution and less representative ratios.

Read [docs/how-lanterna-works.md](docs/how-lanterna-works.md) for the exact integrity and degradation behavior.

## Programmatic Surface

Lanterna is primarily a CLI today, but the package exports the enrichment surface and report types:

```ts
import { enrich, type LanternaReport } from 'lanterna';
import type { Finding, Hotspot } from 'lanterna/report';
```

What is public today:

- `enrich(...)` from the package root
- report-related TypeScript types from `lanterna` and `lanterna/report`

What is not public today:

- spawn collector internals
- attach mode
- in-process capture mode

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
