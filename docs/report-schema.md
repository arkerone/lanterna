# Report Schema (v2.0.0)

A `LanternaReport` is the structured JSON Lanterna emits after every capture. This page describes its shape. For interpretation rules, see [reading-a-report.md](./reading-a-report.md).

> The Zod schema is composed dynamically from active kinds via `buildReportSchema(kinds)` exported by [`@lanterna-profiler/core`](../packages/core). The discriminator below is therefore the source of truth at runtime; this page mirrors it for human reading.

## Top-level shape

```ts
interface LanternaReport {
  meta: Meta;
  profiles: Partial<Record<ReportSectionKey, KindReport>>;
  findings: Finding[];
  extensions?: Record<string, unknown>;
}
```

| Field | Purpose |
| --- | --- |
| `meta` | Capture metadata, mode, duration, successfully captured `profileKinds`, integrity flags. |
| `profiles.<reportSectionKey>` | Per-kind analysis sections. Built-in section keys: `cpu`, `memory`, `async`. |
| `findings` | Cross-kind detector output. Each finding carries a `profileKind` tag. |
| `extensions` | Optional custom section-analyzer output keyed by analyzer namespace. Kind-specific data belongs under `profiles`. |

For built-in kinds, populated `profiles.<kind>` entries match `meta.profileKinds`. Custom kinds may choose a `ProfileKind.reportSectionKey` different from their CLI kind id, so consumers should use the registered kind metadata when handling extension sections.

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

Instrumentation mode (`safe` / `full` / `off`), `maxRecords` cap, stack depth, microtask inclusion, concurrency interval, transform stats, and operation count.

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
| `sourceMaps` | Optional source-map resolution integrity when source maps were enabled for the capture. |
| `kinds.cpu.samplesTimed` | The CPU profile included usable per-sample timing deltas. |
| `kinds.memory.*` | Memory-specific integrity counters when `--kind memory` is active. |
| `kinds.async.*` | Async-specific integrity counters when `--kind async` is active (e.g. `recordsDropped`, partial-capture markers). |

`meta.captureIntegrity.sourceMaps` has this shape:

```ts
interface SourceMapsIntegrity {
  enabled: boolean;
  applicable?: boolean;
  status?: "not-applicable" | "ok" | "partial" | "failed";
  framesResolved: number;
  framesUnresolved: number;
  coverage: number;
  mapsLoaded: number;
  failures: Array<{ url: string; reason: string }>;
}
```

`coverage` is `framesResolved / (framesResolved + framesUnresolved)` for frames whose generated script had a loaded or expected map. Plain JS without `sourceMappingURL` is `applicable: false`, `status: "not-applicable"`, and reports `coverage: 1` so it does not force a rerun. `failures` is capped and omits expected noise such as builtin URLs or files with no `sourceMappingURL`.

## Source locations

Frame-bearing objects keep their generated V8 location and may also include the original source-map location:

```ts
interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  name?: string;
}
```

When present, prefer `source.file:source.line` for human diagnosis and patching, but keep the generated `file:line` as fallback context. On-disk sources are relative to `meta.cwd` when possible. `file://` URLs observed from V8/CDP are normalized back to normal filesystem paths in public report entries when possible. Bundler virtual sources such as `webpack://app/src/server.ts` or `vite:/src/server.ts` are kept verbatim and may not exist on disk.

`source?: SourceLocation` can appear on CPU hotspots, hot-stack frames and anchors, memory allocators and memory summaries, async frame-bearing entries, deopts, and `findings[].evidence`.

`userCaller?: UserCallerAttribution` can appear when Lanterna can identify the user frame that explains a finding. It contains `function`, `file`, `line`, optional `column`/`source`/`stackDistance`, `profilePct`, `supportPct`, `confidence` (`low`/`medium`/`high`), and `basis` (`cpu-sample-path`, `heap-sample-path`, `async-stack`, or `async-cpu-window`). `stackDistance: 1` means the closest user frame to an external callee; `stackDistance: 0` means the sampled user frame itself is the fix location. Attributed findings may also expose `evidence.extra.candidateCallers[]`, ordered by proximity first and support second. Treat low-confidence attribution as an inspection lead, not automatically as the line to patch.

## `profiles.cpu`

| Section | Purpose |
| --- | --- |
| `summary` | High-level CPU ratios (user / node_modules / builtin / native / GC / idle), `topCategory`, `dominantBlockingKind`, `topCpuCulprit`, `topRequestEntry`, `topUserHotspot`. |
| `quality` | Confidence gate for CPU evidence — `confidence`, `sampleCount`, `durationMs`, `idleRatio`, `samplesTimed`, `durationBasis`, `reasons[]`, `recommendations[]`. |
| `hotspots` | Aggregated functions with `selfMs`/`selfPct` and `totalMs`/`totalPct`, `callers[]`/`callees[]`, `category`, `optimizationState`, and optional `userCaller` for non-user frames. |
| `hotStacks` | Most frequent complete sampled stacks with `weightPct` and `frames[]`. |
| `hotStackClusters` | Optional hot-stack groups anchored on the nearest user-code frame. |
| `gc` | Pause totals, counts, `longestPauseMs`, `pausesOver10ms`, `correlatedHotspots`. |
| `eventLoop` | `available`, `measurementBasis` (`both`/`heartbeats`/`histogram`/`none`), `confidence`, lag percentiles, `stallIntervals`, `correlatedHotspots`. |
| `deopts` | V8 deoptimisation clusters — populated only when `meta.kinds.cpu.deep === true`. |

Detail: [kinds/cpu.md](./kinds/cpu.md).

## `profiles.memory`

| Section | Purpose |
| --- | --- |
| `summary` | Total sampled bytes, top allocator, RSS / heapUsed / external / arrayBuffers stats (start/end/min/max/mean/p95) plus linear `slopeBytesPerSec`. |
| `quality` | Memory confidence gate — `confidence`, `reasons[]`, `recommendations[]`. |
| `hotAllocators` | Frames ranked by `selfBytes` / `totalBytes`, with file/line, frame category, and optional `userCaller`. |
| `memoryUsage` | Compact `process.memoryUsage()` metadata (`sampleCount`, first/last sample). Raw samples present only with `--include-memory-samples`. |
| `heapSnapshotAnalysis` | Optional start/end retained-growth summary when `--heap-snapshot-analysis` is enabled. Very large snapshots return `available: false` with a warning instead of being parsed unbounded. |

Detail: [kinds/memory.md](./kinds/memory.md).

## `profiles.async` (experimental)

Async resource lifecycle summaries, `topOperations`, `hotFiles`, `chains`, `orphans`, `concurrencyTimeline`, `filteredCounts`, `cdpAsyncContexts`, `cpuAttribution`, and quality metadata. Only present when `--kind async` was selected. In attach mode, capture is intentionally partial — the section's `quality` records this.

Detail: [kinds/async.md](./kinds/async.md).

## `findings[]`

Each finding has the same shape regardless of which kind produced it:

| Field | Purpose |
| --- | --- |
| `id` | Detector-specific identifier (e.g. `blocking-io:fs.readFileSync`, `cpu-hotspot:<frame>`). |
| `profileKind` | Source kind (`"cpu"`, `"memory"`, `"async"`, …). |
| `severity` | `critical`, `warning`, or `info`. |
| `category` | Grouping for filtering. |
| `title` | Short human label. |
| `confidence` | Optional detector confidence (`high`, `medium`, `low`). Built-in detectors set it. |
| `proofLevel` | Optional evidence class: `direct-sample`, `correlated-window`, `trace-only`, or `heuristic`. Built-in detectors set it. |
| `evidence.file` / `evidence.line` / `evidence.function` | Where the action should happen (often the user caller, not the builtin callee). |
| `evidence.selfPct` | CPU/allocation weight attributed to that evidence. |
| `evidence.extra` | Detector-specific metadata. |
| `why` | Why this pattern matters. |
| `suggestion` | Concrete remediation hint. |
| `references` | Links to docs or related findings. |

Findings are sorted by `priority.score`, then severity, then attributed weight.

Common `evidence.extra` anchors:

| Field | Meaning |
| --- | --- |
| `userCaller` | User-code caller or self frame that should usually be inspected before the callee/runtime frame. |
| `candidateCallers[]` | Alternative caller candidates for attributed CPU findings. |
| `correlatedAllocator` | Memory trend findings (`memory-growth:*`, `external-buffer-pressure`) use this to point from process-level growth back to an editable allocator lead. `basis` distinguishes heap-sampled allocators from CPU fallback attribution. |
| `entryFrame` | `hot-async-context:*` keeps the hot CPU frame in `evidence.*` and exposes the async chain entry point here. |

The full catalog of built-in findings, grouped by kind, is in [extending/detectors.md](./extending/detectors.md#built-in-findings).

## Schema versioning

This is **schema v2.0.0**. The defining trait of v2 is per-kind nesting under `profiles.<reportSectionKey>.*` and `meta.kinds.<kindId>.*`. Additive optional fields can appear within the same major schema; breaking changes should bump the version. Consumers should branch on the fields they need rather than on the version alone.

## See also

- [reading-a-report.md](./reading-a-report.md) — interpretation playbook.
- [signal-quality.md](./signal-quality.md) — confidence and integrity flags in depth.
- [kinds/cpu.md](./kinds/cpu.md), [kinds/memory.md](./kinds/memory.md), [kinds/async.md](./kinds/async.md) — per-kind details.
