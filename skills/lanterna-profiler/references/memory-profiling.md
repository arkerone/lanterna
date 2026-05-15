# Memory Profiling Reference

Use this for capture and interpretation when the user is investigating memory growth, leaks, OOM kills, Buffer / off-heap pressure, or "this endpoint allocates too much". This reference supports an interactive investigation — read the agent report first, then return here to disambiguate the memory signal (allocation churn vs leak, JS heap vs off-heap, slope vs noise) before patching.

For CPU-specific interpretation, see [cpu-profiling.md](cpu-profiling.md). For the overall report shape, see [report-schema.md](report-schema.md).

## When to capture memory

Trigger on signals like:

- Sustained RSS growth, OOM-killed pods, `--max-old-space-size` exceeded.
- "Heap snapshot too big to read" — start with Lanterna's sampling profile. If retention, constructor growth, or retainer paths matter, add `--heap-snapshot-analysis` with `--kind memory`; it is intentionally opt-in because snapshots are slow and can be large.
- Buffer / TypedArray / native-module heavy workloads (image processing, compression, parsers, crypto).
- Allocation-heavy hot paths suspected of co-driving CPU cost.

Do **not** trigger memory capture for "code is slow" alone — that's a CPU question. Combine `--kind cpu --kind memory` only when the user explicitly cares about both, since memory adds a small but non-zero overhead.

## How memory capture works

- **V8 sampling heap profiler** (`HeapProfiler.startSampling` / `stopSampling`). Statistical: each sampled allocation is attributed to its call stack with a size estimate. Default sampling interval is 512 KiB (`--heap-sample-interval <bytes>` to override).
- **`process.memoryUsage()` time series** — a preload hook samples at a fixed cadence (default 250 ms, `--memory-usage-interval <ms>` to override) and emits RSS / heapTotal / heapUsed / external / arrayBuffers.
- **Optional heap snapshot analysis** (`--heap-snapshot-analysis`) captures one V8 heap snapshot before sampling and one after sampling, writes both `.heapsnapshot` files, parses the V8 graph, ignores weak edges for retention paths, computes retained-size growth by constructor, and adds short retainer paths with heuristic labels. Files default to `.lanterna-heapsnapshots` under the launch cwd; use `--heap-snapshot-dir <dir>` to choose a different directory.
- The sampling profiler is low overhead (typically < 3 % wall-time on the synthetic test workload). Heap snapshot analysis is not low overhead; reserve it for leak/retention investigations and longer windows where the extra capture cost is acceptable.
- If the user stops with `Ctrl+C`, Lanterna prioritizes responsiveness: it aborts any heap snapshot currently in progress and skips the final heap snapshot. The normal memory report remains available, while `heapSnapshotAnalysis.available` is false with a warning. To get the start/end snapshot comparison, prefer `--duration` or let the target exit naturally.

Stop conditions specific to memory:

- A capture under ~2 s with < 8 series samples is unreliable for `memory-growth` (slope is noisy). Ask the user to extend the duration before asserting a leak.
- An empty `hotAllocators[]` with `memoryUsage.sampleCount > 0` means no allocations crossed the sampling threshold during capture — typically a steady-state workload reusing pools, or too short a window.

## Reading Memory Evidence

Start from the agent report, not from JSON:

1. frontmatter — memory usage availability, heap snapshot warnings, `rerun_required`, integrity and source-map caveats.
2. `## Findings` table / `## Finding N` blocks / `Findings.decision` column — memory findings, proof level, measurements, and actionability.
3. `Kind Review` -> `memory` — memory usage, top allocator, hot allocators, user callers, and heap snapshot summary.
4. `Files To Read First` — table of editable source locations to inspect before proposing patches. `read-first` rows are the primary queue; `inspect-lead` rows need confirmation; `supporting-context` rows provide surrounding evidence.
5. Use `rerun_required`, caveats, and any `decision = rerun` finding to decide whether to request a better capture before diagnosis.

Use the JSON shape below only when the agent report does not render a memory field you need to clarify.

## Targeted JSON Lookup: `profiles.memory`

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
    "available": true,
    "sampleIntervalMs": 250,
    "sampleCount": 12,
    "firstSample": { "atMs": 0, "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 },
    "lastSample": { "atMs": 2750, "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 }
  },
  "heapSnapshotAnalysis": {
    "available": true,
    "mode": "start-end",
    "start": { "path": "/tmp/lanterna-heaps/lanterna-123-start.heapsnapshot" },
    "end": { "path": "/tmp/lanterna-heaps/lanterna-123-end.heapsnapshot" },
    "summary": {
      "totalRetainedGrowthBytes": 0,
      "topGrowingConstructor": "Map"
    },
    "growthByConstructor": [
      {
        "name": "Map",
        "countDelta": 1,
        "selfSizeDeltaBytes": 0,
        "retainedSizeDeltaBytes": 0
      }
    ],
    "retainerPaths": [
      {
        "constructorName": "LeakedThing",
        "retainedBytes": 0,
        "path": ["(GC roots)", "Map", "entries", "LeakedThing"],
        "suspectedPattern": "cache",
        "confidence": "medium"
      }
    ],
    "warnings": []
  }
}
```

Targeted lookup order after the agent report:

1. `summary.rss.slopeBytesPerSec` — positive and large means growth. Compare with `heapUsed` slope: if RSS grows but heapUsed is flat, the leak is off-heap (Buffer / native). If both grow, it's likely a JS-heap leak.
2. `summary.topAllocator` and `hotAllocators[0..N]` — actionable allocation sources.
3. `summary.externalRatio` — > 0.5 hints at off-heap dominance.
4. `memoryUsage.firstSample` / `lastSample` — quick endpoints. Re-run with `--include-memory-samples` only when the slope alone is ambiguous and you need the full curve (e.g. step changes vs. steady growth).
5. `heapSnapshotAnalysis` — present only with `--heap-snapshot-analysis`. Treat `available: false` plus `warnings[]` as a graceful degradation; the normal memory report still applies. Use `growthByConstructor[]` to identify growing object families and `retainerPaths[]` to inspect likely retainers. Heuristic labels are clues, not proof.

`selfBytes` is bytes attributed exclusively to the frame; `totalBytes` includes its callees. Treat node\_modules / builtin frames as **symptoms**, not root causes — open the user-code caller first. In the agent report, `Files To Read First.reason` distinguishes allocator frames, dependency callers, runtime callers, generated output fallbacks, and supporting context. Pseudo/runtime allocator rows are filtered out of Kind Review tables unless an editable user caller can anchor the work.

## Source Positions

`hotAllocators[]`, `summary.topAllocator`, and memory findings (`evidence`) may carry a resolved `source` object. Always prefer `source.file:source.line` over `file:line` when present — `file:line` points at the compiled JS, `source.*` at the original TypeScript or bundled source. Fall back to `file:line` when `source` is absent. Use `source.name` if `function` is `(anonymous)`. Treat virtual paths (`webpack://`, `vite:/`) as bundler labels, not editable files, unless they resolve on disk. Quality gate: `meta.captureIntegrity.sourceMaps.coverage`.

## Memory findings

| Finding id | Category | Trigger |
|---|---|---|
| `memory-growth:rss` | `memory-growth` | RSS linear slope ≥ 1 MB/s (warning) or ≥ 5 MB/s (critical), capture ≥ 2 s and ≥ 8 samples. |
| `memory-growth:heapUsed` | `memory-growth` | Same shape as `:rss` but on `heapUsed`. Less prone to off-heap noise. |
| `large-allocator:<frame>` | `large-allocator` | A single frame ≥ 15 % of sampled bytes (`totalPct` or `selfPct`); critical at ≥ 40 %. Skips synthetic frames `(root)`, `(idle)`, `(program)`, `(garbage collector)`. |
| `external-buffer-pressure` | `external-buffer-pressure` | Mean `external` ≥ 0.5 × `heapUsed` and ≥ 32 MB absolute. Critical at ≥ 1.5×. |
| `alloc-in-hot-path:<frame>` | `alloc-in-hot-path` | Same frame appears in top CPU hotspots (`totalPct ≥ 5 %`) **and** top memory allocators (`totalPct ≥ 5 %`). Requires `--kind cpu --kind memory` or `--kind cpu,memory`. Critical when combined % ≥ 60. |

Each memory finding's `evidence.extra` carries the raw counters (slope, MB delta, ratio, combined pct). Use top-level `confidence`, `proofLevel`, and `measurements.thresholds` to explain *why* the finding fired and how strongly to trust it.

## Common interpretation patterns

- **RSS grows linearly, `heapUsed` flat, `external` rising** → off-heap leak. Suspect Buffer pools not reset, pino transports buffering, native modules (sharp, libpq, zlib streams). `external-buffer-pressure` will usually co-fire. `arrayBuffers` is already included in `external`, so use it as a breakdown signal, not as an additive term.
- **Both RSS and `heapUsed` grow** → JS heap leak. Look for unbounded `Map`/`Set`, long-lived listeners, Promise chains retaining context. Lanterna shows allocators from sampling; use `--heap-snapshot-analysis` and `heapSnapshotAnalysis.retainerPaths[]` for Lanterna's retained-growth and retainer clues. Chrome DevTools heap snapshots are an optional external fallback only when Lanterna lacks the needed retention signal.
- **`heapSnapshotAnalysis.retainerPaths[]` points through `_events`, `Timeout`, or `Map.entries`** → likely listener, timer, or cache retention respectively. Confirm in source before patching because labels are heuristic and V8 internal paths can be noisy.
- **No growth, but `large-allocator` fires hard** → allocation churn. Hot path allocates and frees rapidly, driving GC pauses. Often co-fires with `excessive-gc` from the CPU side. Pool/reuse, prefer for-loops to `map+filter+slice` chains, avoid intermediate strings/objects.
- **`alloc-in-hot-path` fires** → highest-leverage fix in the report. Reducing allocations on this frame cuts both CPU and GC.

## Targeted jq snippets

Use these only after reading `report.agent.md`, and only to clarify a field not rendered by frontmatter, `Kind Review`, `## Findings` table, or `## Finding N` blocks.

```bash
# Memory summary at a glance
jq '.profiles.memory.summary | {topAllocator, rssMB:{start:(.rss.startBytes/1048576),end:(.rss.endBytes/1048576),slope:(.rss.slopeBytesPerSec/1048576)}, externalRatio}' report.json

# Top allocators
jq '.profiles.memory.hotAllocators[:5] | .[] | {fn:.function, file, line, selfMB:(.selfBytes/1048576), selfPct, totalPct}' report.json

# Memory findings only
jq '.findings[] | select(.profileKind == "memory") | {id, severity, confidence, proofLevel, file:.evidence.file, line:.evidence.line}' report.json

# RSS curve as CSV (requires --include-memory-samples)
jq -r '.profiles.memory.memoryUsage.samples[] | [.atMs, (.rss/1048576), (.heapUsed/1048576), (.external/1048576)] | @csv' report.json

# Heap snapshot retained-growth summary (requires --heap-snapshot-analysis)
jq '.profiles.memory.heapSnapshotAnalysis | {available, top:.summary.topGrowingConstructor, warnings, groups:.growthByConstructor[:10]}' report.json

# Retainer paths and heuristic labels
jq '.profiles.memory.heapSnapshotAnalysis.retainerPaths[] | {constructorName, retainedBytes, suspectedPattern, confidence, path}' report.json
```

## Stop conditions specific to memory

Stop and ask the user when:

- The capture window is < 2 s — slope is unreliable, do not assert a leak.
- The agent frontmatter section does not list `memory` — the user did not request memory capture; do not invent memory observations from the CPU profile.
- `memoryUsage.available` is false — the preload hook didn't run (e.g. no inspector). Time-series claims are not supported; only `hotAllocators` (from the CDP-side sampling profile) remain trustworthy.
- `heapSnapshotAnalysis.available` is false — snapshot capture or parsing failed. Read `warnings[]`, keep using `summary`, `hotAllocators`, and `memoryUsage`, and avoid retainer claims.
- The user mentions "OOM" but `summary.rss.maxBytes` is far below the host memory limit — the run probably did not reach the failure window; ask for a longer capture or one started closer to the OOM event.

Never claim "this leaks because ..." without:

1. positive `slopeBytesPerSec` over a window ≥ 2 s, AND
2. an actionable frame in `hotAllocators[]` corroborated by reading the cited file.
