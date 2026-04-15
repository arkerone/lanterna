# How Lanterna Works

This document explains the runtime flow behind `lanterna run`, the shape of the data pipeline, and the cases where Lanterna can only provide a partial signal.

## Mental Model

Lanterna has two major phases:

1. capture raw profiling and timing data from a Node.js child process
2. enrich that capture into a `LanternaReport`

The capture phase is currently implemented only in spawn mode. Lanterna starts the process itself, enables the inspector, injects a preload hook, and stops the capture when the child exits or the requested duration expires.

## Runtime Flow

### 1. Spawn and prepare the target

`lanterna run -- <command>` delegates to `SpawnSource`.

Before spawning, Lanterna extends `NODE_OPTIONS` with:

- `--inspect-brk=0` to start the Node inspector on a random port and pause before user code runs
- `--require=<event-loop-hook>` to inject the preload hook
- `--trace-deopt` when `--deep` is enabled

It also sets:

- `LANTERNA_ACTIVE=1`
- `LANTERNA_CONTROL_FD=3`

The child is spawned with an extra file descriptor used as a control channel. That control channel carries best-effort JSON events from the preload hook to the parent process.

### 2. Connect to the inspector

Lanterna waits for the target to print the inspector WebSocket URL, then connects to it over the Chrome DevTools Protocol.

From that point, it can:

- query runtime metadata
- start and stop the V8 sampling CPU profiler
- release the paused process with `Runtime.runIfWaitingForDebugger`
- query globals published by the preload hook

If the inspector never becomes available, the run fails fast. Lanterna does not silently fall back to a weaker profiling mode.

### 3. Preload hook responsibilities

The preload hook does not capture CPU samples. That still comes from V8's CPU profiler through CDP.

Its job is to publish runtime timing signals that are difficult to infer from the raw CPU profile alone:

- event-loop heartbeat samples roughly every 20ms
- event-loop histogram summary via `monitorEventLoopDelay`
- GC pause events via `PerformanceObserver`
- lifecycle events such as hook readiness and app completion

These events are emitted over the control FD as JSON lines. The parent process treats this channel as best effort:

- malformed events are ignored
- if the channel is partially unavailable, Lanterna still tries to produce a report
- capture integrity flags record which timed signals were actually observed

### 4. Start capture

Once the inspector is connected, Lanterna:

1. marks the start of the capture in the target runtime
2. starts the V8 CPU profiler with the configured sample interval
3. releases the paused process

From that point until stop time, three signal families accumulate:

- CPU samples from the V8 profiler
- timed event-loop heartbeat samples and histogram data
- timed GC events

If `--deep` is enabled, V8 deoptimisation traces are also collected from the child's `stderr` and parsed later into grouped `deopts[]`.

### 5. Stop capture

Lanterna stops when either:

- the requested duration elapses
- the target process finishes first

During shutdown it:

- reads the final event-loop summary from the target
- stops the CPU profiler and retrieves the raw profile
- normalizes timed samples to the capture window
- closes the CDP connection
- gives the process a short chance to exit cleanly, then escalates to `SIGTERM` and `SIGKILL` if needed

The final output of this phase is a `RawCapture`.

## Enrichment Pipeline

The enricher transforms `RawCapture` into `LanternaReport`.

### Frame classification

Each frame is classified into one of these categories:

- `user`
- `node_modules`
- `node:builtin`
- `native`
- `gc`
- `program`
- `idle`
- `unknown`

This matters because the summary ratios and several findings depend on the distinction between user code and everything else.

Examples:

- a function inside the target cwd becomes `user`
- a package under `node_modules` becomes `node_modules`
- `node:crypto` frames become `node:builtin`
- unnamed runtime frames with no URL often become `native`

The Lanterna preload hook itself is deliberately classified as internal/native noise rather than user code.

### Hotspots

Lanterna aggregates nodes that share the same `(file, function, line)` into a public hotspot representation.

Each hotspot includes:

- direct CPU (`selfMs`, `selfPct`)
- inclusive CPU (`totalMs`, `totalPct`)
- top callers
- top callees
- optimization state

This is the main bridge between raw V8 data and actionable analysis.

### Hot stacks

Lanterna also keeps the most frequent complete sampled stacks. Hot stacks are useful when a single hotspot is ambiguous and you need to see the surrounding call path.

### Timed correlation

The raw CPU profile says where CPU time went, but not always when latency symptoms occurred. Lanterna uses timed runtime signals to add that missing dimension.

It builds time windows for:

- event-loop stalls
- GC pauses

Then it correlates sampled user-code hotspots with those windows. That is how the report can say things like:

- this user function overlapped most measured stall windows
- this hotspot is a likely contributor to GC pressure

Correlation is intentionally conservative. If no single user frame dominates the measured windows strongly enough, Lanterna reports ranked candidates instead of over-claiming certainty.

### Findings

Findings are detectors running on the enriched report, not on the raw capture.

Current detectors cover:

- synchronous crypto on the hot path
- blocking sync I/O on the hot path
- excessive GC
- event-loop stalls
- repeated deoptimisation loops
- module loading on the hot path

Findings are sorted by severity first, then by attributed CPU weight.

## Understanding Signal Quality

Lanterna exposes several indicators so downstream consumers can judge how trustworthy a report is.

### `meta.captureIntegrity`

These flags record which data paths worked during capture:

- `controlChannel`: the preload hook successfully talked to the parent
- `eventLoopTimed`: timed event-loop heartbeat data was observed
- `gcTimed`: timed GC events were observed
- `cpuSamplesTimed`: the CPU profile included timing deltas

If one of these flags is false, the report is still usable, but some interpretation should be more cautious.

### `eventLoop.measurementBasis`

Event-loop lag may come from:

- `heartbeats`
- `histogram`
- `both`
- `none`

`both` is the strongest signal. `none` means Lanterna could not obtain a usable event-loop signal and `eventLoop.available` will be false.

### `eventLoop.confidence`

Lanterna reduces event-loop confidence when the signal is incomplete:

- `high` when it has the strongest basis
- `low` when only a weaker basis is available
- `none` when no usable signal exists

This affects how strongly Lanterna can attribute a stall to a specific user-code hotspot.

## Failure and Degradation Modes

### Inspector unavailable

Lanterna requires inspector support. If the target runtime cannot start the inspector, the run fails instead of pretending to profile successfully.

### Partial preload-hook signal

If the preload hook loads but one of its channels degrades:

- the report can still contain CPU hotspots
- event-loop or GC timing may be partial or absent
- integrity flags and event-loop metadata show what was lost

### Low-load captures

A technically valid profile may still be operationally weak:

- high `idleRatio` means the process spent most of the capture idle
- short captures may under-sample real bottlenecks
- no meaningful workload means the hottest code path might just be startup noise

### `--deep` disabled

Without `--deep`, deopt tracing is intentionally absent. `deopts[]` will be empty and no `deopt-loop:*` findings can be emitted.

## What Lanterna Does Not Do Today

Lanterna does not currently:

- attach to an already-running process
- expose a public capture API for embedding the collector in another tool
- generate flamegraphs as its primary output
- infer source-level fixes by itself; it emits evidence and suggestions, but the actual remediation still belongs to the user or an agent consuming the report

## Recommended Reading Order

If you are new to the project:

1. read the quick start and scope notes in `README.md`
2. read [reading-a-report.md](reading-a-report.md)
3. come back to this document when you want to understand why a specific field or confidence level exists
