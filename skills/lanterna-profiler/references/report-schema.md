# LanternaReport — JSON Schema Reference

This document describes every field in the JSON output produced by `lanterna run`. Use it to parse and interpret the report programmatically.

---

## Top-level structure

```json
{
  "meta":      { ... },
  "summary":   { ... },
  "hotspots":  [ ... ],
  "hotStacks": [ ... ],
  "gc":        { ... },
  "eventLoop": { ... },
  "deopts":    [ ... ],
  "findings":  [ ... ]
}
```

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
| `sampleIntervalMicros` | number | V8 sampling interval in microseconds (default 1000 = 1ms) |
| `totalSamples` | number | Number of V8 tick samples collected |
| `cwd` | string | Working directory of the profiled process |
| `command` | string[] | Command that was run, e.g. `["node", "app.js"]` |
| `lanternaVersion` | string | Lanterna version that produced the report |
| `mode` | `"spawn"` \| `"attach"` \| `"in-process"` | How the profiler was connected. The CLI can emit `"spawn"` or `"attach"` depending on how Lanterna was invoked. |
| `deep` | boolean | Whether `--deep` mode was active (enables deopt tracing) |
| `captureIntegrity.controlChannel` | boolean | Whether the timed control channel from the preload hook was active |
| `captureIntegrity.controlChannelExpected` | boolean | Whether the control channel should have been available for this mode |
| `captureIntegrity.eventLoopTimed` | boolean | Whether event loop lag came from timed heartbeat samples |
| `captureIntegrity.gcTimed` | boolean | Whether GC pauses carried real timestamps |
| `captureIntegrity.cpuSamplesTimed` | boolean | Whether CPU samples had real `timeDeltas[]` timing |
| `captureIntegrity.gcObserverAvailable` | boolean | Whether the runtime GC observer was installed |
| `captureIntegrity.controlChannelWriteErrors` | number | Failed writes from the runtime hook to the control channel |
| `captureIntegrity.gcObserverSetupFailed` | number | Failed attempts to install the runtime GC observer |
| `captureIntegrity.heartbeatDropped` | number | Heartbeat samples that could not be emitted over the control channel |

---

## `summary`

All ratios are between 0 and 1.

| Field | Type | Description |
|---|---|---|
| `totalCpuMs` | number | Total on-CPU time (ms) — excludes idle samples |
| `onCpuRatio` | number | Fraction of samples where the process was not idle |
| `userCodeRatio` | number | Fraction of on-CPU time in **user code** (relative to on-CPU, not total) |
| `nodeModulesRatio` | number | Fraction in `node_modules` dependencies |
| `builtinRatio` | number | Fraction in Node.js built-in modules (`node:fs`, `node:crypto`, …) |
| `nativeRatio` | number | Fraction in native C++ / V8 internals |
| `gcRatio` | number | Fraction of on-CPU time consumed by the garbage collector |
| `idleRatio` | number | Fraction of total samples that were idle (not useful work) |
| `topCategory` | string | Category with the highest sample count: `"user"` \| `"node_modules"` \| `"node:builtin"` \| `"native"` \| `"gc"` |
| `dominantBlockingKind` | `"sync-crypto"` \| `"blocking-io"` \| `null` | Coarse blocking classification derived from findings |
| `topUserHotspot` | object? | Dominant user-code CPU hotspot for context; not an actionable finding by itself |

**Interpretation tip**: If `gcRatio > 0.10`, look at the `excessive-gc` finding. If `userCodeRatio` is low and `builtinRatio` is high, the bottleneck is a sync built-in call (sync crypto, sync I/O).

---

## `hotspots[]`

Each hotspot is a function aggregated across all V8 nodes sharing the same `(file, functionName, line)`.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier: `"<file>:<line>:<functionName>"` |
| `function` | string | Function name as reported by V8 |
| `file` | string | Path **relative to cwd** for user code; full module specifier for builtins |
| `line` | number | Source line (1-based) |
| `column` | number | Source column (1-based) |
| `category` | string | `"user"` \| `"node_modules"` \| `"node:builtin"` \| `"native"` \| `"gc"` \| `"idle"` \| `"unknown"` |
| `package` | string? | npm package name if `category = "node_modules"` |
| `selfMs` | number | Time (ms) spent **directly** in this function (exclusive) |
| `selfPct` | number | `selfMs` as percentage of **total samples** |
| `totalMs` | number | Time (ms) in this function **including all descendants** (inclusive) |
| `totalPct` | number | `totalMs` as percentage of total samples |
| `callers` | `{ id, pct }[]` | Top-3 callers by sample weight |
| `callees` | `{ id, pct }[]` | Top-3 callees by sample weight |
| `optimizationState` | `"optimized"` \| `"interpreted"` \| `"unknown"` | V8 JIT state |

**Action tip**: hotspots are sorted by `selfPct` descending — the first entry is where the CPU spends the most time directly.

---

## `hotStacks[]`

The top-10 most frequent complete call stacks sampled.

| Field | Type | Description |
|---|---|---|
| `weightPct` | number | Fraction of total samples with this exact stack |
| `frames[]` | array | Stack frames from leaf (hottest) to root |
| `frames[].function` | string | Function name |
| `frames[].file` | string | File (relative or module specifier) |
| `frames[].line` | number | Line number |
| `frames[].category` | string | Same as hotspot category |

---

## `gc`

| Field | Type | Description |
|---|---|---|
| `totalPauseMs` | number | Sum of all GC pause durations |
| `count.scavenge` | number | Minor GC (young generation) count |
| `count.markSweep` | number | Major GC (full mark-compact) count |
| `count.incremental` | number | Incremental mark-sweep steps count |
| `count.other` | number | Other GC events |
| `longestPauseMs` | number | Duration of the single longest GC pause |
| `pausesOver10ms[]` | array | All pauses ≥ 10ms with `atMs`, `kind`, `durationMs` |
| `correlatedHotspots[]` | array | Top user hotspots observed around GC pause windows |

**Threshold**: `longestPauseMs > 100` → `excessive-gc` finding.

---

## `eventLoop`

Available only when Lanterna obtained a usable event-loop signal (`available: true`).

| Field | Type | Description |
|---|---|---|
| `available` | boolean | Whether event loop sampling was active |
| `measurementBasis` | `"both"` \| `"heartbeats"` \| `"histogram"` \| `"none"` | Where the lag numbers came from. `both` = timed heartbeats *and* `monitorEventLoopDelay` histogram (strongest). `heartbeats` = timed preload samples only. `histogram` = histogram only (no temporal stall windows — `stallIntervals[]` will be empty or aggregate-only). `none` = no signal. |
| `confidence` | `"high"` \| `"low"` \| `"none"` | Qualitative trust in the lag numbers. Degrade claims when `low`/`none`. |
| `sampleCount` | number | Number of timed heartbeat samples collected |
| `maxLagMs` | number | Maximum observed event loop delay (ms) |
| `p99LagMs` | number | 99th percentile lag |
| `p50LagMs` | number | Median lag |
| `meanLagMs` | number | Mean lag |
| `histogram` | object? | Raw `monitorEventLoopDelay` percentiles when available |
| `stallIntervals[]` | array | Intervals where lag exceeded 200ms. Empty when `measurementBasis === "histogram"`. |
| `correlatedHotspots[]` | array | Top user hotspots whose CPU samples overlapped the stall windows. Each entry carries `rank` (1-indexed), `overlapPct`, `samplePct`, and `confidence` (`low` / `medium` / `high`). Only treat as causal when `confidence === 'high'`. |

**Threshold**: `maxLagMs > 200` or `p99LagMs > 100` → `event-loop-stall` finding.

**Attribution rule**: if `measurementBasis === "histogram"`, `stallIntervals[]` is empty and `correlatedHotspots[].overlapPct` is aggregate — **not** temporal. Name a suspect but do not assert causation.

---

## `deopts[]`

Only populated when `meta.deep = true` (`--deep` flag). Requires `--trace-deopt` in the child process.

| Field | Type | Description |
|---|---|---|
| `function` | string | Deoptimised function name |
| `file` | string | Source file |
| `line` | number | Line number |
| `reason` | string | V8 deopt reason (e.g. `"not a Smi"`, `"wrong map"`) |
| `bailoutType` | string | V8 bailout type (`eager`, `lazy`, `soft`) |
| `count` | number | Number of times this deopt occurred in the session |
| `explanation` | string | Human-readable explanation of the V8 reason |

**Threshold**: `count ≥ 5` → `deopt-loop` finding.

---

## `findings[]`

**This is the primary output for agent consumption.** Each finding is an actionable signal.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique detector ID, e.g. `"sync-crypto-on-hot-path"` |
| `severity` | `"info"` \| `"warning"` \| `"critical"` | Priority signal |
| `category` | string | Finding category (see below) |
| `title` | string | One-line human-readable title |
| `evidence.file` | string | Source file of the offending code |
| `evidence.line` | number | Source line |
| `evidence.function` | string | Function name |
| `evidence.selfPct` | number | CPU % attributed to this hotspot |
| `evidence.extra` | object? | Category-specific additional data. See `evidence.extra` fields below. |
| `measurements.observed` | object? | Raw observed values that caused the finding to fire, e.g. `{ totalPct: 12.4, categoryTotalPct: 18 }`. Compare against `thresholds` to rank findings without parsing `why`. |
| `measurements.thresholds` | object? | Threshold values the detector used, e.g. `{ minTotalPct: 1, criticalPct: 10 }`. |
| `priority.score` | number | Precomputed action priority; higher should be handled first |
| `priority.impactEstimateMs` | number? | Estimated impact when available |
| `priority.actionConfidence` | `"low"` \| `"medium"` \| `"high"` | Confidence that the suggested action targets the cause |
| `remediation.kind` | `"async-variant"` \| `"lazy-import-hoist"` \| `"offload-worker"` \| `"replace-library"` \| `"cache"` \| `"other"` | Category of mechanical fix. Present on ★★★ detectors (blocking-io, sync-crypto, require-in-hot-path) when confidence is sufficient. |
| `remediation.replace` | string? | Symbol or call signature to look for in user code |
| `remediation.with` | string? | Recommended replacement symbol or call signature |
| `remediation.module` | string? | Source module of the replacement, e.g. `node:fs/promises` |
| `remediation.docs` | string? | Canonical reference URL |
| `remediation.notes` | string? | Non-machine-actionable hint (edge-case notes) |
| `why` | string | Why this is a problem in the context of this profile |
| `suggestion` | string | Concrete, code-level remediation action |
| `references[]` | string[] | URLs to Node.js / V8 documentation |

### `evidence.extra` — shared fields

Not every detector populates every field; read defensively.

| Field | Type | Description |
|---|---|---|
| `proofLevel` | `"direct-builtin"` \| `"attributed-caller"` \| `"aggregate-correlation"` \| `"deopt-trace-only"` | How the detector reached this conclusion. `direct-builtin` / `attributed-caller` are actionable; `aggregate-correlation` / `deopt-trace-only` are hypotheses. |
| `attributionBasis` | `"sample-path"` \| `"builtin-only"` | How `evidence.file:line` was resolved to user code (for attributed findings). |
| `attributionConfidence` | `"low"` \| `"high"` | Trust that the user caller is the right place to patch. `"low"` → do not patch automatically. |
| `userAttribution` | object? | Hot user-frame backing the attribution (id, function, file, line, samplePct, supportPct). |
| `api` / `callee` | string? | The builtin or library entry point the detector locked onto. |
| `calleeTotalPct` | number? | Inclusive CPU % for this specific callee. |
| `categoryTotalPct` | number? | Sum of `totalPct` across every frame in the same detector family (all sync fs, all sync crypto, all JSON, all require…). If much larger than `calleeTotalPct`, the problem is structural — patching one line won't move the needle. |
| `eventLoopCorrelation.overlapPct` | number? | % of measured stall windows overlapping this frame's samples. `≥50` is a causal lead; `0` is circumstantial. Always read alongside `eventLoop.measurementBasis` — `"histogram"` means overlap is aggregate, not temporal. |
| `eventLoopCorrelation.samplePct` | number? | Sample share for this frame during stall windows. |
| `candidateHotspots[]` | array? | For `excessive-gc` and `event-loop-stall`: ranked user-frame candidates with `rank`, `overlapPct`, `confidence` (`low`/`medium`/`high`). |
| `alternativeHotspots[]` | array? | Runner-up user frames for `node-modules-hotspot` attribution. |
| `hotStackClusters[]` | array? | Groups of hot stacks sharing a user-code anchor. When several findings point at the same anchor, treat them as one problem. |

### Built-in finding categories

| id | category | Trigger |
|---|---|---|
| `sync-crypto-on-hot-path` | `sync-crypto` | `pbkdf2Sync`/`scryptSync`/`randomBytesSync` with `totalPct >= 1%` |
| `blocking-io:<api>` | `blocking-io` | Sync fs/child_process/zlib API with meaningful `selfPct` or `totalPct` |
| `json-on-hot-path:<api>` | `json-on-hot-path` | `JSON.parse` / `JSON.stringify` consuming meaningful CPU |
| `node-modules-hotspot:<package>` | `node-modules-hotspot` | A dependency frame dominates meaningful CPU time |
| `excessive-gc` | `excessive-gc` | `gcRatio > 10%` OR `longestPauseMs > 100ms` |
| `event-loop-stall` | `event-loop-stall` | `maxLagMs >= 200ms` OR `p99LagMs >= 100ms` |
| `deopt-loop:<fn>` | `deopt-loop` | Same function deoptimised ≥ 5 times (requires `--deep`) |
| `require-in-hot-path` | `require-in-hot-path` | `Module._load` / `require` on hot path with meaningful sample weight |

Findings are sorted by `priority.score` first, then by severity and `evidence.selfPct`.

> Lanterna supports third-party detector plugins loaded via `--detectors <spec>` or `.lanterna.json`. A report may therefore contain `finding.category` values that are **not** in the table above. Treat unknown categories as extension findings with `evidence.extra` that is schema-defined by the plugin author — not by the core schema.
