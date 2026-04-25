# LanternaReport — Schema v2 Reference

This reference describes the JSON emitted by Lanterna's current schema (`2.x`).

Per-kind analysis lives under `report.profiles.<kind>.*`. Today the built-in kind is `cpu`, so most real reports expose `report.profiles.cpu.*`. `findings[]` stays cross-kind at the root, and each finding carries a required `profileKind`.

---

## Top-level structure

```json
{
  "meta": { ... },
  "profiles": {
    "cpu": {
      "summary": { ... },
      "hotspots": [ ... ],
      "hotStacks": [ ... ],
      "gc": { ... },
      "eventLoop": { ... },
      "deopts": [ ... ]
    }
  },
  "findings": [ ... ],
  "extensions": {
    "...": { ... }
  }
}
```

`extensions` is optional and is only populated by custom section analyzers.

---

## `meta`

| Field | Type | Description |
|---|---|---|
| `nodeVersion` | string | e.g. `"v24.2.0"` |
| `v8Version` | string | e.g. `"12.4.254.20"` |
| `platform` | string | `"linux"`, `"darwin"`, `"win32"` |
| `arch` | string | `"x64"`, `"arm64"` |
| `pid` | number | PID of the profiled process |
| `startedAt` | string (ISO 8601) | When profiling started |
| `durationMs` | number | Wall-clock duration of the profiling session |
| `cwd` | string | Working directory of the profiled process |
| `command` | string[] | Spawned command, or `[]` in attach mode |
| `lanternaVersion` | string | Lanterna version that produced the report |
| `mode` | `"spawn"` \| `"attach"` \| `"in-process"` | How the profiler connected |
| `profileKinds` | string[] | Kinds captured in declared order, e.g. `["cpu"]` |
| `kinds` | `Record<string, unknown>` | Per-kind meta contributions, keyed by kind id (see below) |
| `captureIntegrity.*` | object | Quality indicators for runtime signals and timing |

### `meta.kinds.cpu` (CPU-flavoured fields, used to live at the top of `meta`)

| Field | Type | Description |
|---|---|---|
| `samplesTotal` | number | Number of V8 tick samples collected |
| `sampleIntervalMicros` | number | V8 sampling interval in microseconds |
| `deep` | boolean | Whether deopt tracing was enabled (`--deep`) |

Important `captureIntegrity` flags:

| Flag | Meaning when `false` |
|---|---|
| `controlChannel` | Spawn preload could not send control-channel events |
| `controlChannelExpected` | Control channel should have existed for this mode |
| `eventLoopTimed` | Event-loop timing fell back to histogram-only or was absent |
| `gcTimed` | GC events have no real timestamps |
| `gcObserverAvailable` | Runtime GC observer could not be installed |

### `meta.captureIntegrity.kinds.cpu` (CPU-specific integrity signal)

| Flag | Meaning when `false` |
|---|---|
| `samplesTimed` | CPU timing had to degrade from exact `timeDeltas[]` |

---

## `profiles`

`profiles` is a map keyed by profile kind id. Today the only shipped key is `cpu`.

### `profiles.cpu.summary`

All ratios are between `0` and `1`.

| Field | Type | Description |
|---|---|---|
| `totalCpuMs` | number | Total on-CPU time excluding idle samples |
| `onCpuRatio` | number | Fraction of samples where the process was not idle |
| `userCodeRatio` | number | Fraction of on-CPU time in user code |
| `nodeModulesRatio` | number | Fraction in `node_modules` dependencies |
| `builtinRatio` | number | Fraction in Node built-ins such as `node:fs` |
| `nativeRatio` | number | Fraction in native/V8 internals |
| `gcRatio` | number | Fraction of on-CPU time spent in GC |
| `idleRatio` | number | Fraction of total samples that were idle |
| `topCategory` | string | Dominant sample category |
| `dominantBlockingKind` | `"sync-crypto"` \| `"blocking-io"` \| `null` | Coarse blocking classification derived from findings |
| `topUserHotspot` | object? | Dominant user-code hotspot for context, not a finding |

### `profiles.cpu.hotspots[]`

Each hotspot aggregates V8 nodes sharing `(file, function, line)`.

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable identifier: `"<file>:<line>:<function>"` |
| `function` | string | Function name reported by V8 |
| `file` | string | User-relative path or builtin/module specifier |
| `line` | number | 1-based source line |
| `column` | number | 1-based source column |
| `category` | string | `"user"` \| `"node_modules"` \| `"node:builtin"` \| `"native"` \| `"gc"` \| `"idle"` \| `"unknown"` |
| `package` | string? | npm package name when `category === "node_modules"` |
| `selfMs` | number | Exclusive CPU time in ms |
| `selfPct` | number | Exclusive CPU share |
| `totalMs` | number | Inclusive CPU time in ms |
| `totalPct` | number | Inclusive CPU share |
| `callers` | `{ id, pct }[]` | Top caller frames by sample weight |
| `callees` | `{ id, pct }[]` | Top callee frames by sample weight |
| `optimizationState` | `"optimized"` \| `"interpreted"` \| `"unknown"` | V8 JIT state |

### `profiles.cpu.hotStacks[]`

The most frequent complete sampled stacks.

| Field | Type | Description |
|---|---|---|
| `weightPct` | number | Share of samples with this exact stack |
| `frames[]` | array | Frames ordered leaf-to-root |
| `frames[].function` | string | Function name |
| `frames[].file` | string | Source file or builtin/module specifier |
| `frames[].line` | number | Source line |
| `frames[].category` | string | Same category taxonomy as hotspots |

`profiles.cpu.hotStackClusters[]` may also be present. It groups hot stacks by user-code anchor when multiple findings point to the same feature area.

### `profiles.cpu.gc`

| Field | Type | Description |
|---|---|---|
| `totalPauseMs` | number | Sum of all GC pauses |
| `count.scavenge` | number | Minor GC count |
| `count.markSweep` | number | Major GC count |
| `count.incremental` | number | Incremental GC count |
| `count.other` | number | Other GC events |
| `longestPauseMs` | number | Longest observed pause |
| `pausesOver10ms[]` | array | All pauses ≥ 10ms with `atMs`, `kind`, `durationMs` |
| `correlatedHotspots[]` | array | Ranked user hotspots seen around GC pause windows |

### `profiles.cpu.eventLoop`

| Field | Type | Description |
|---|---|---|
| `available` | boolean | Whether a usable event-loop signal exists |
| `measurementBasis` | `"both"` \| `"heartbeats"` \| `"histogram"` \| `"none"` | Source of lag data |
| `confidence` | `"high"` \| `"low"` \| `"none"` | Trust level for event-loop attribution |
| `sampleCount` | number | Timed heartbeat samples collected |
| `maxLagMs` | number | Maximum observed lag |
| `p99LagMs` | number | 99th percentile lag |
| `p50LagMs` | number | Median lag |
| `meanLagMs` | number | Mean lag |
| `histogram` | object? | Raw `monitorEventLoopDelay` percentiles |
| `stallIntervals[]` | array | Measured stall windows; empty for histogram-only mode |
| `correlatedHotspots[]` | array | Ranked user hotspots overlapping stall windows |

Interpretation rule:

- `measurementBasis === "histogram"` means `correlatedHotspots[].overlapPct` is aggregate, not temporally aligned.
- Only treat a specific hotspot as causal when its correlation `confidence === "high"`.

### `profiles.cpu.deopts[]`

Only populated when `meta.kinds.cpu.deep === true`.

| Field | Type | Description |
|---|---|---|
| `function` | string | Deoptimized function name |
| `file` | string | Source file |
| `line` | number | Source line |
| `reason` | string | V8 deopt reason |
| `bailoutType` | string | V8 bailout type |
| `count` | number | Number of times the deopt occurred |
| `explanation` | string | Human-readable explanation |

---

## `findings[]`

`findings[]` is the primary agent-facing output. It is cross-kind and sorted by action priority.

| Field | Type | Description |
|---|---|---|
| `id` | string | Detector identifier, e.g. `"sync-crypto-on-hot-path"` |
| `profileKind` | string | Kind that emitted the finding, e.g. `"cpu"` |
| `severity` | `"info"` \| `"warning"` \| `"critical"` | Priority bucket |
| `category` | string | Finding family |
| `title` | string | One-line summary |
| `evidence.file` | string | Source file to inspect first |
| `evidence.line` | number | Source line |
| `evidence.function` | string | Function name |
| `evidence.selfPct` | number | CPU share attributed to this evidence |
| `evidence.extra` | object? | Detector-specific attribution and correlation details |
| `measurements.observed` | object? | Raw observed values that triggered the finding |
| `measurements.thresholds` | object? | Detector thresholds used for comparison |
| `priority.score` | number | Precomputed action ordering |
| `priority.impactEstimateMs` | number? | Estimated impact when available |
| `priority.actionConfidence` | `"low"` \| `"medium"` \| `"high"` | How likely the suggested action targets the cause |
| `remediation.*` | object? | Mechanical patch hints when confidence is sufficient |
| `why` | string | Why the detector fired in this capture |
| `suggestion` | string | Concrete remediation direction |
| `references[]` | string[] | Supporting docs |

Shared `evidence.extra` fields:

| Field | Type | Description |
|---|---|---|
| `proofLevel` | `"direct-builtin"` \| `"attributed-caller"` \| `"aggregate-correlation"` \| `"deopt-trace-only"` | Strength of the detector's proof |
| `attributionBasis` | `"sample-path"` \| `"builtin-only"` | How user-code attribution was resolved |
| `attributionConfidence` | `"low"` \| `"high"` | Whether a caller is safe to patch mechanically |
| `userAttribution` | object? | Backing user hotspot for an attributed finding |
| `api` / `callee` | string? | Builtin or library entry point locked by the detector |
| `calleeTotalPct` | number? | Inclusive CPU share of that specific callee |
| `categoryTotalPct` | number? | Family-wide CPU share across the detector category |
| `eventLoopCorrelation.overlapPct` | number? | Overlap with measured stall windows |
| `eventLoopCorrelation.samplePct` | number? | Sample share during stall windows |
| `candidateHotspots[]` | array? | Ranked user-frame candidates for GC/stall findings |
| `alternativeHotspots[]` | array? | Runner-up attribution candidates |
| `hotStackClusters[]` | array? | Related hot-stack groups sharing a user anchor |

Built-in categories commonly seen today:

| id | category | Trigger |
|---|---|---|
| `sync-crypto-on-hot-path` | `sync-crypto` | Sync crypto on a meaningful hot path |
| `blocking-io:<api>` | `blocking-io` | Sync fs/child_process/zlib API on the hot path |
| `json-on-hot-path:<api>` | `json-on-hot-path` | `JSON.parse` / `JSON.stringify` dominating CPU |
| `node-modules-hotspot:<package>` | `node-modules-hotspot` | Dependency frame dominates meaningful CPU |
| `excessive-gc` | `excessive-gc` | High GC ratio or long pause |
| `event-loop-stall` | `event-loop-stall` | High p99/max lag |
| `deopt-loop:<fn>` | `deopt-loop` | Same function deoptimized repeatedly |
| `require-in-hot-path` | `require-in-hot-path` | Module loading on a hot path |

Third-party detector plugins may add additional categories. Unknown categories should be treated as extension findings, not schema violations.
