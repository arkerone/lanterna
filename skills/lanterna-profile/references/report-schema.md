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
| `mode` | `"spawn"` \| `"attach"` \| `"in-process"` | How the profiler was connected. The current CLI implementation emits `"spawn"` only. |
| `deep` | boolean | Whether `--deep` mode was active (enables deopt tracing) |
| `captureIntegrity.controlChannel` | boolean | Whether the timed control channel from the preload hook was active |
| `captureIntegrity.eventLoopTimed` | boolean | Whether event loop lag came from timed heartbeat samples |
| `captureIntegrity.gcTimed` | boolean | Whether GC pauses carried real timestamps |
| `captureIntegrity.cpuSamplesTimed` | boolean | Whether CPU samples had real `timeDeltas[]` timing |

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
| `sampleCount` | number | Number of timed heartbeat samples collected |
| `maxLagMs` | number | Maximum observed event loop delay (ms) |
| `p99LagMs` | number | 99th percentile lag |
| `p50LagMs` | number | Median lag |
| `meanLagMs` | number | Mean lag |
| `stallIntervals[]` | array | Intervals where lag exceeded 200ms |
| `correlatedHotspots[]` | array | Top user hotspots whose CPU samples overlapped the stall windows |

**Threshold**: `maxLagMs > 200` or `p99LagMs > 100` → `event-loop-stall` finding.

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
| `evidence.extra` | object? | Category-specific additional data, including correlation candidates where available |
| `why` | string | Why this is a problem in the context of this profile |
| `suggestion` | string | Concrete, code-level remediation action |
| `references[]` | string[] | URLs to Node.js / V8 documentation |

### Finding categories

| id | category | Trigger |
|---|---|---|
| `sync-crypto-on-hot-path` | `sync-crypto` | `pbkdf2Sync`/`scryptSync`/`randomBytesSync` with `totalPct >= 1%` |
| `blocking-io:<api>` | `blocking-io` | Sync fs/child_process/zlib API with meaningful `selfPct` or `totalPct` |
| `excessive-gc` | `excessive-gc` | `gcRatio > 10%` OR `longestPauseMs > 100ms` |
| `event-loop-stall` | `event-loop-stall` | `maxLagMs >= 200ms` OR `p99LagMs >= 100ms` |
| `deopt-loop:<fn>` | `deopt-loop` | Same function deoptimised ≥ 5 times (requires `--deep`) |
| `require-in-hot-path` | `require-in-hot-path` | `Module._load` / `require` on hot path with meaningful sample weight |

Findings are sorted: `critical > warning > info`, then by `evidence.selfPct` descending.
