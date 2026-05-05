# CPU Kind

The default profile kind. Captures the V8 sampling profiler plus timed runtime signals (event-loop lag, GC pauses) and turns them into hotspots, hot stacks, and CPU detector findings.

| Property | Value |
| --- | --- |
| Kind id | `cpu` |
| Default? | Yes — `--kind cpu` is the default for `lanterna run` and `lanterna attach`. |
| Report sections | `profiles.cpu.{summary, quality, hotspots, hotStacks, gc, eventLoop, deopts}` |
| Meta | `meta.kinds.cpu` |
| Integrity | `meta.captureIntegrity.kinds.cpu` |

## Capture

```bash
# Default — `--kind cpu` is implicit
lanterna run --duration 30s --output report.json -- node app.js

# Tighten the sample interval
lanterna run --duration 30s --sample-interval 250 -- node app.js

# Enable V8 deopt tracing (run-only)
lanterna run --deep --duration 30s -- node app.js
```

CPU-specific options:

| Option | Effect |
| --- | --- |
| `--sample-interval <us>` | V8 sampling interval. Default `1000` µs, min `50`. Lower values increase precision but add overhead. |
| `--deep` | Adds `--trace-deopt` to the spawned process. Required for `profiles.cpu.deopts[]` and the `deopt-loop:*` finding. **Spawn-only** — `attach` rejects it. |

## Report sections

### `summary`

| Field | Meaning |
| --- | --- |
| `onCpuRatio` | Fraction of samples doing work. |
| `userCodeRatio` / `nodeModulesRatio` / `builtinRatio` / `nativeRatio` / `gcRatio` | On-CPU time per frame category. |
| `idleRatio` | Fraction of samples spent idle. |
| `topCategory` | Dominant non-idle category. |
| `dominantBlockingKind` | Coarse summary derived from emitted findings (e.g. `sync-crypto`, `blocking-io`). |
| `topUserHotspot` | Set when a single user function dominates user CPU. |

### `quality`

Confidence gate for the CPU section. See [signal-quality.md](../signal-quality.md#profilescpuquality) for the full field reference.

### `hotspots`

Aggregated nodes sharing `(file, function, line)`. Each entry has direct CPU (`selfMs`, `selfPct`), inclusive CPU (`totalMs`, `totalPct`), top callers/callees, frame `category`, and V8 `optimizationState` (`optimized` / `interpreted` / `unknown`).

For non-user frames, `userCaller` is present when a user-code ancestor was observed on sampled paths. `profilePct` is the share of the whole CPU profile attributed to that caller; `supportPct` is the share of the external frame's sampled paths explained by that caller. Findings only move their primary evidence to the caller for high-confidence attribution; low-confidence callers remain visible as an inspection lead.

`selfMs` / `totalMs` come from V8 `timeDeltas[]` when available (`quality.durationBasis === "timeDeltas"`), otherwise they are estimated from the configured `sampleIntervalMicros` (`durationBasis === "sampleInterval"`). When estimated, prefer the percentage fields.

### `hotStacks`

Most frequent complete sampled stacks, weighted by share of total samples. Useful when a single hotspot is ambiguous and you need the surrounding call path.

### `eventLoop`

Latency signal correlated with stall windows. Quality of this section is described by `measurementBasis` and `confidence` — see [signal-quality.md](../signal-quality.md#profilescpueventloop).

### `gc`

Pause counts, total pause time, longest pause, detailed list of pauses over 10 ms, and `correlatedHotspots[]` ranked by overlap with GC windows.

### `deopts`

V8 deoptimisation clusters with `function`, `file`, `line`, `reason`, `bailout`, `count`, and `explanation`. Empty unless `meta.kinds.cpu.deep === true`.

## Findings

| Finding id | Trigger |
| --- | --- |
| `sync-crypto-on-hot-path` | Sampled sync crypto frame (`pbkdf2Sync`, `scryptSync`, …) with `totalPct >= 1`, optionally attributed to a user caller. |
| `blocking-io:<api>` | Sampled sync `fs` / `child_process` / `zlib` frame with meaningful CPU. |
| `json-on-hot-path:<api>` | `JSON.parse` / `JSON.stringify` consuming meaningful CPU. |
| `node-modules-hotspot:<package>` | A dependency frame dominates meaningful CPU time. |
| `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms`. |
| `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200`. |
| `deopt-loop:<function>` | Same deoptimised function seen ≥ 5 times (`--deep`) and hot in the CPU profile. |
| `require-in-hot-path` | Module loading functions sampled on the hot path. |

Each finding ships with `confidence`, `proofLevel`, `evidence.file/line/function`, `selfPct`, a `why` rationale, and a `suggestion`. See [extending/detectors.md](../extending/detectors.md) to write your own.

## Reading order

1. `quality.confidence` and `quality.reasons[]` — is the profile worth acting on?
2. `summary.topCategory` and `summary.dominantBlockingKind` — where is CPU concentrated?
3. `findings[]` filtered to `profileKind === "cpu"` — prioritized hypotheses.
4. Top 5 `hotspots` even when no finding fired — direct evidence.
5. `eventLoop` — translates CPU pressure into latency.
6. `gc` — allocation pressure and pauses.
7. `hotStacks` — when a hotspot is ambiguous, look at the surrounding stack.
8. `deopts` — only with `--deep`, and only repeated entries matter.

For full interpretation rules and common mistakes, see [reading-a-report.md](../reading-a-report.md).

## Frame classification

Every sampled frame is placed into exactly one category:

| Category | Criterion |
| --- | --- |
| `user` | Path is under the target's `cwd`. |
| `node_modules` | Path contains `node_modules`. |
| `node:builtin` | URL starts with `node:`. |
| `native` | No script URL — V8/C++ frame. |
| `gc` | V8 GC synthetic frames. |
| `program` | `(program)` pseudo-frame. |
| `idle` | `(idle)` pseudo-frame. |
| `lanterna` | Lanterna's preload, runtime-signals hook, or `node_modules/@lanterna/*`. Dropped from `hotspots` and retainer paths so the report only describes the profiled application. Set `LANTERNA_DEBUG_SELF=1` to keep them visible when working on Lanterna itself. |
| `unknown` | Fallback. |

The classification feeds `summary` ratios and several finding heuristics. Self-noise filters are extensible — see [architecture.md](../architecture.md#noise-filters-extension-point).

## Caveats

- A hotspot in `node_modules` or `node:builtin` is often a **symptom**. Inspect the user caller before blaming the dependency.
- High `nativeRatio` is normal for CPU work that lives in C++ (crypto, compression, JSON). Look at user callers, not just the leaf.
- `cwd` mismatch between Lanterna and the target can mis-classify your code as `node_modules`. Check `meta.cwd`.
