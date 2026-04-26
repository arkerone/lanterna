# Memory Profiling Reference

Use this for capture and interpretation when the user is investigating memory growth, leaks, OOM kills, Buffer / off-heap pressure, or "this endpoint allocates too much". For CPU-specific interpretation, see [cpu-profiling.md](cpu-profiling.md). For the overall report shape, see [report-schema.md](report-schema.md).

## When to capture memory

Trigger on signals like:

- Sustained RSS growth, OOM-killed pods, `--max-old-space-size` exceeded.
- "Heap snapshot too big to read" — Lanterna's sampling profile is the right primary tool; snapshots remain useful for retention but Lanterna does not capture them in v1.
- Buffer / TypedArray / native-module heavy workloads (image processing, compression, parsers, crypto).
- Allocation-heavy hot paths suspected of co-driving CPU cost.

Do **not** trigger memory capture for "code is slow" alone — that's a CPU question. Combine `--kind cpu --kind memory` only when the user explicitly cares about both, since memory adds a small but non-zero overhead.

## How memory capture works

- **V8 sampling heap profiler** (`HeapProfiler.startSampling` / `stopSampling`). Statistical: each sampled allocation is attributed to its call stack with a size estimate. Default sampling interval is 512 KiB (`--heap-sample-interval <bytes>` to override).
- **`process.memoryUsage()` time series** — a preload hook samples at a fixed cadence (default 250 ms, `--memory-usage-interval <ms>` to override) and emits RSS / heapTotal / heapUsed / external / arrayBuffers.
- The sampling profiler is low overhead (typically < 3 % wall-time on the synthetic test workload). It does **not** snapshot the heap — there is no retention graph, no retainer paths, no per-object inspection.

Stop conditions specific to memory:

- A capture under ~2 s with < 8 series samples is unreliable for `memory-growth` (slope is noisy). Ask the user to extend the duration before asserting a leak.
- An empty `hotAllocators[]` with non-empty `memoryUsage.samples` means no allocations crossed the sampling threshold during capture — typically a steady-state workload reusing pools, or too short a window.

## Reading `profiles.memory`

```json
{
  "summary": {
    "totalSampledBytes": 0,
    "samplingIntervalBytes": 524288,
    "rss":           { "startBytes": 0, "endBytes": 0, "minBytes": 0, "maxBytes": 0, "meanBytes": 0, "p95Bytes": 0, "slopeBytesPerSec": 0 },
    "heapUsed":      { "...": "same shape" },
    "external":      { "...": "same shape" },
    "arrayBuffers":  { "...": "same shape" },
    "topAllocator":  { "function": "", "file": "", "line": 0, "selfPct": 0, "totalPct": 0 },
    "externalRatio": 0
  },
  "hotAllocators": [
    {
      "id": "<file:line:col:fn>",
      "function": "",
      "file": "",
      "line": 0,
      "column": 0,
      "category": "user|node_modules|node:builtin|native",
      "package": "<optional>",
      "selfBytes": 0,
      "selfPct": 0,
      "totalBytes": 0,
      "totalPct": 0
    }
  ],
  "memoryUsage": {
    "samples": [
      { "atMs": 0, "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 }
    ],
    "available": true,
    "sampleIntervalMs": 250
  }
}
```

Reading order:

1. `summary.rss.slopeBytesPerSec` — positive and large means growth. Compare with `heapUsed` slope: if RSS grows but heapUsed is flat, the leak is off-heap (Buffer / native). If both grow, it's likely a JS-heap leak.
2. `summary.topAllocator` and `hotAllocators[0..N]` — actionable allocation sources.
3. `summary.externalRatio` — > 0.5 hints at off-heap dominance.
4. `memoryUsage.samples[]` — eyeball the curve only when the slope alone is ambiguous (e.g. step changes vs. steady growth).

`selfBytes` is bytes attributed exclusively to the frame; `totalBytes` includes its callees. Treat node\_modules / builtin frames as **symptoms**, not root causes — open the user-code caller first.

## Memory findings

| Finding id | Category | Trigger |
|---|---|---|
| `memory-growth:rss` | `memory-growth` | RSS linear slope ≥ 1 MB/s (warning) or ≥ 5 MB/s (critical), capture ≥ 2 s and ≥ 8 samples. |
| `memory-growth:heapUsed` | `memory-growth` | Same shape as `:rss` but on `heapUsed`. Less prone to off-heap noise. |
| `large-allocator:<frame>` | `large-allocator` | A single frame ≥ 15 % of sampled bytes (`totalPct` or `selfPct`); critical at ≥ 40 %. Skips synthetic frames `(root)`, `(idle)`, `(program)`, `(garbage collector)`. |
| `external-buffer-pressure` | `external-buffer-pressure` | Mean `external` ≥ 0.5 × `heapUsed` and ≥ 32 MB absolute. Critical at ≥ 1.5×. |
| `alloc-in-hot-path:<frame>` | `alloc-in-hot-path` | Same frame appears in top CPU hotspots (`totalPct ≥ 5 %`) **and** top memory allocators (`totalPct ≥ 5 %`). Requires `--kind cpu memory`. Critical when combined % ≥ 60. |

Each memory finding's `evidence.extra` carries the raw counters (slope, MB delta, ratio, combined pct). Use `measurements.thresholds` to explain *why* the finding fired.

## Common interpretation patterns

- **RSS grows linearly, `heapUsed` flat, `external` rising** → off-heap leak. Suspect Buffer pools not reset, pino transports buffering, native modules (sharp, libpq, zlib streams). `external-buffer-pressure` will usually co-fire. `arrayBuffers` is already included in `external`, so use it as a breakdown signal, not as an additive term.
- **Both RSS and `heapUsed` grow** → JS heap leak. Look for unbounded `Map`/`Set`, long-lived listeners, Promise chains retaining context. Lanterna shows the *allocators*; finding the *retainers* requires a heap snapshot from Chrome DevTools.
- **No growth, but `large-allocator` fires hard** → allocation churn. Hot path allocates and frees rapidly, driving GC pauses. Often co-fires with `excessive-gc` from the CPU side. Pool/reuse, prefer for-loops to `map+filter+slice` chains, avoid intermediate strings/objects.
- **`alloc-in-hot-path` fires** → highest-leverage fix in the report. Reducing allocations on this frame cuts both CPU and GC.

## jq snippets

```bash
# Memory summary at a glance
jq '.profiles.memory.summary | {topAllocator, rssMB:{start:(.rss.startBytes/1048576),end:(.rss.endBytes/1048576),slope:(.rss.slopeBytesPerSec/1048576)}, externalRatio}' report.json

# Top allocators
jq '.profiles.memory.hotAllocators[:5] | .[] | {fn:.function, file, line, selfMB:(.selfBytes/1048576), selfPct, totalPct}' report.json

# Memory findings only
jq '.findings[] | select(.profileKind == "memory") | {id, severity, file:.evidence.file, line:.evidence.line}' report.json

# RSS curve as CSV (for plotting)
jq -r '.profiles.memory.memoryUsage.samples[] | [.atMs, (.rss/1048576), (.heapUsed/1048576), (.external/1048576)] | @csv' report.json
```

## Stop conditions specific to memory

Stop and ask the user when:

- The capture window is < 2 s — slope is unreliable, do not assert a leak.
- `meta.profileKinds` does not include `memory` — the user did not request memory capture; do not invent memory observations from the CPU profile.
- `memoryUsage.available` is false — the preload hook didn't run (e.g. no inspector). Time-series claims are not supported; only `hotAllocators` (from the CDP-side sampling profile) remain trustworthy.
- The user mentions "OOM" but `summary.rss.maxBytes` is far below the host memory limit — the run probably did not reach the failure window; ask for a longer capture or one started closer to the OOM event.

Never claim "this leaks because ..." without:

1. positive `slopeBytesPerSec` over a window ≥ 2 s, AND
2. an actionable frame in `hotAllocators[]` corroborated by reading the cited file.
