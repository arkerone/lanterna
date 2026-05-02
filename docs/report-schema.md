# Report Schema (v2)

A `LanternaReport` is the structured JSON Lanterna emits after every capture. This page describes its shape. For interpretation rules, see [reading-a-report.md](./reading-a-report.md).

> The Zod schema is composed dynamically from active kinds via `buildReportSchema(kinds)` exported by [`@lanterna-profiler/core`](../packages/core). The discriminator below is therefore the source of truth at runtime; this page mirrors it for human reading.

## Top-level shape

```ts
interface LanternaReport {
  meta: Meta;
  profiles: Partial<Record<KindId, KindReport>>;
  findings: Finding[];
}
```

| Field | Purpose |
| --- | --- |
| `meta` | Capture metadata, mode, duration, successfully captured `profileKinds`, integrity flags. |
| `profiles.<kind>` | Per-kind analysis sections. Built-in kinds: `cpu`, `memory`, `async`. |
| `findings` | Cross-kind detector output. Each finding carries a `profileKind` tag. |

The set of populated `profiles.<kind>` entries matches `meta.profileKinds`.

## `meta`

| Field | Meaning |
| --- | --- |
| `durationMs` | Wall-clock duration of the capture. |
| `command` | Executed command, or `[]` in attach mode. |
| `mode` | `"spawn"` or `"attach"`. |
| `cwd` | Working directory used to classify `user` frames. |
| `profileKinds` | Kinds that produced capture data, in declared order. |
| `kinds` | Per-kind metadata contributions. CPU lives under `meta.kinds.cpu`, memory under `meta.kinds.memory`, async under `meta.kinds.async`. |
| `captureIntegrity` | Quality indicators for timed signals (and per-kind under `captureIntegrity.kinds.<id>`). |

### `meta.kinds.cpu`

| Field | Meaning |
| --- | --- |
| `samplesTotal` | Number of V8 tick samples collected. |
| `sampleIntervalMicros` | V8 CPU sampling interval. |
| `deep` | Whether `--trace-deopt` was enabled. |

### `meta.kinds.memory`

Heap sampling configuration, RSS series cadence, and heap snapshot status (when `--heap-snapshot-analysis` is enabled).

### `meta.kinds.async`

Instrumentation mode (`safe` / `full` / `off`), max events cap, stack depth, microtask inclusion, concurrency interval, and warning counters such as dropped events or failed instrumentation.

### `meta.captureIntegrity`

| Flag | Meaning |
| --- | --- |
| `controlChannel` | The preload hook successfully talked to the parent (spawn mode only). |
| `controlChannelExpected` | Whether the control channel was expected to be available. `false` in attach mode. |
| `eventLoopTimed` | Timed event-loop heartbeat data was observed. |
| `gcTimed` | Timed GC events were observed. |
| `gcObserverAvailable` | The `PerformanceObserver` GC observer was installed successfully. |
| `controlChannelWriteErrors` | Counter — write failures on FD 3. |
| `gcObserverSetupFailed` | Counter — GC observer setup failures in target. |
| `heartbeatDropped` | Counter — heartbeats lost. |
| `kinds.cpu.samplesTimed` | The CPU profile included usable per-sample timing deltas. |
| `kinds.memory.*` | Memory-specific integrity counters when `--kind memory` is active. |
| `kinds.async.*` | Async-specific integrity counters when `--kind async` is active (e.g. dropped events, partial-capture markers). |

## `profiles.cpu`

| Section | Purpose |
| --- | --- |
| `summary` | High-level CPU ratios (user / node_modules / builtin / native / GC / idle), `topCategory`, `dominantBlockingKind`, `topUserHotspot`. |
| `quality` | Confidence gate for CPU evidence — `confidence`, `sampleCount`, `durationMs`, `idleRatio`, `samplesTimed`, `durationBasis`, `reasons[]`, `recommendations[]`. |
| `hotspots` | Aggregated functions with `selfMs`/`selfPct` and `totalMs`/`totalPct`, `callers[]`/`callees[]`, `category`, `optimizationState`. |
| `hotStacks` | Most frequent complete sampled stacks with `weightPct` and `frames[]`. |
| `gc` | Pause totals, counts, `longestPauseMs`, `pausesOver10ms`, `correlatedHotspots`. |
| `eventLoop` | `available`, `measurementBasis` (`both`/`heartbeats`/`histogram`/`none`), `confidence`, lag percentiles, `stallIntervals`, `correlatedHotspots`. |
| `deopts` | V8 deoptimisation clusters — populated only when `meta.kinds.cpu.deep === true`. |

Detail: [kinds/cpu.md](./kinds/cpu.md).

## `profiles.memory`

| Section | Purpose |
| --- | --- |
| `summary` | Total sampled bytes, top allocator, RSS / heapUsed / external / arrayBuffers stats (start/end/min/max/mean/p95) plus linear `slopeBytesPerSec`. |
| `hotAllocators` | Frames ranked by `selfBytes` / `totalBytes`, with file/line and frame category. |
| `memoryUsage` | Compact `process.memoryUsage()` metadata (`sampleCount`, first/last sample). Raw samples present only with `--include-memory-samples`. |
| `heapSnapshotAnalysis` | Optional start/end retained-growth summary when `--heap-snapshot-analysis` is enabled. Very large snapshots are skipped with a warning instead of being parsed unbounded. |

Detail: [kinds/memory.md](./kinds/memory.md).

## `profiles.async` (experimental)

Async resource lifecycle, concurrency timeline, awaits, orphans, CDP async-stack support, and quality metadata. Only present when `--kind async` was selected. In attach mode, capture is intentionally partial — the section's `quality` records this.

Detail: [kinds/async.md](./kinds/async.md).

## `findings[]`

Each finding has the same shape regardless of which kind produced it:

| Field | Purpose |
| --- | --- |
| `id` | Detector-specific identifier (e.g. `blocking-io:fs.readFileSync`). |
| `profileKind` | Source kind (`"cpu"`, `"memory"`, `"async"`, …). |
| `severity` | `critical`, `warning`, or `info`. |
| `category` | Grouping for filtering. |
| `title` | Short human label. |
| `confidence` | Detector confidence (`high`, `medium`, `low`). |
| `proofLevel` | Evidence class: `direct-sample`, `correlated-window`, `trace-only`, or `heuristic`. |
| `evidence.file` / `evidence.line` / `evidence.function` | Where the action should happen (often the user caller, not the builtin callee). |
| `evidence.selfPct` | CPU/allocation weight attributed to that evidence. |
| `evidence.extra` | Detector-specific metadata. |
| `why` | Why this pattern matters. |
| `suggestion` | Concrete remediation hint. |
| `references` | Links to docs or related findings. |

Findings are sorted by `priority.score`, then severity, then attributed weight.

The full catalog of built-in findings, grouped by kind, is in [extending/detectors.md](./extending/detectors.md#built-in-findings).

## Schema versioning

This is **schema v2**. The defining trait of v2 is per-kind nesting under `profiles.<id>.*` and `meta.kinds.<id>.*`. Future schema changes will bump the version; consumers should branch on the discriminator they need rather than on the version itself.

## See also

- [reading-a-report.md](./reading-a-report.md) — interpretation playbook.
- [signal-quality.md](./signal-quality.md) — confidence and integrity flags in depth.
- [kinds/cpu.md](./kinds/cpu.md), [kinds/memory.md](./kinds/memory.md), [kinds/async.md](./kinds/async.md) — per-kind details.
