# Memory Kind

Heap allocation profile + a continuous `process.memoryUsage()` time series, with optional V8 heap snapshot comparison. Designed to surface allocation hotspots, sustained growth, and off-heap pressure.

| Property | Value |
| --- | --- |
| Kind id | `memory` |
| Default? | No — opt in with `--kind memory`. |
| Report sections | `profiles.memory.{summary, hotAllocators, memoryUsage, heapSnapshotAnalysis?}` |
| Meta | `meta.kinds.memory` |
| Integrity | `meta.captureIntegrity.kinds.memory` |

## Capture

```bash
# Memory only
lanterna run --kind memory --duration 30s --output report.json -- node app.js

# Memory + CPU together (enables alloc-in-hot-path correlation)
lanterna run --kind cpu,memory --duration 30s -- node app.js

# Heavy: heap snapshot start vs end
lanterna run \
  --kind memory \
  --heap-snapshot-analysis \
  --heap-snapshot-dir .lanterna-heapsnapshots \
  --duration 60s \
  -- node app.js
```

Memory-specific options:

| Option | Effect |
| --- | --- |
| `--heap-sample-interval <size>` | V8 heap sampling interval. Accepts `524288`, `512KiB`, `1MiB`. Default `512KiB`, min `1KiB`. Smaller intervals catch smaller allocations at the cost of overhead. |
| `--memory-usage-interval <ms>` | `process.memoryUsage()` cadence. Default `250` ms, min `10`. |
| `--include-memory-samples` | Include raw `process.memoryUsage()` samples in JSON output (otherwise only summary stats are kept). |
| `--heap-snapshot-analysis` | Capture V8 heap snapshots at start and end, then synthesize retained-growth. Heavy on memory and disk. |
| `--heap-snapshot-dir <dir>` | Directory for `.heapsnapshot` files. Default `.lanterna-heapsnapshots`. |

> **`Ctrl+C` and snapshots.** When `--heap-snapshot-analysis` is active, stopping early skips the final snapshot so Lanterna exits promptly. Use `--duration` or let the target exit naturally when you need the start/end retained-growth comparison.

## Report sections

### `summary`

Total sampled bytes, top allocator, and stats per memory metric (`rss`, `heapUsed`, `external`, `arrayBuffers`):

| Field per metric | Meaning |
| --- | --- |
| `startBytes` / `endBytes` | First and last sample. |
| `minBytes` / `maxBytes` / `meanBytes` / `p95Bytes` | Distribution stats. |
| `slopeBytesPerSec` | Linear growth slope. Drives `memory-growth:*` findings. |

### `hotAllocators`

Frames ranked by `selfBytes` / `totalBytes` with file/line, frame `category`, and `selfPct` / `totalPct`. Same classification rules as CPU hotspots — `lanterna` self-noise is filtered out.

### `memoryUsage`

Compact metadata: `sampleCount`, first/last sample timestamps. Raw samples are present only when `--include-memory-samples` is set.

### `heapSnapshotAnalysis` (optional)

When `--heap-snapshot-analysis` is enabled, contains a start/end retained-growth synthesis: top retainer paths, growth in retained sizes, and noise-filtered constructor groups. Very large snapshots are **skipped with a warning** rather than parsed unbounded — `heapSnapshotAnalysis.skipped` records this so consumers can tell silence from absence.

## Findings

| Finding id | Trigger |
| --- | --- |
| `memory-growth:rss` / `memory-growth:heapUsed` | Sustained linear growth ≥ 1 MB/s (warning) or ≥ 5 MB/s (critical) over the capture window. |
| `large-allocator:<frame>` | A single frame accounts for ≥ 15 % of sampled allocations. |
| `external-buffer-pressure` | Mean `external` exceeds 0.5× `heapUsed` (and ≥ 32 MB absolute). |
| `alloc-in-hot-path:<frame>` | Cross-kind: same frame is hot on CPU **and** in top allocators. Requires `--kind cpu memory`. |

`alloc-in-hot-path` is the highest-value memory finding when you also captured CPU: it isolates allocators that pay both a GC cost (memory) and a direct CPU cost (allocation overhead) — usually the best place to apply object pooling or buffer reuse.

## Reading order

1. `summary.rss.slopeBytesPerSec` and `summary.heapUsed.slopeBytesPerSec` — is memory growing during the capture?
2. `findings[]` filtered to `profileKind === "memory"` — prioritized allocation issues.
3. `hotAllocators[0..5]` even without findings — direct evidence of where bytes come from.
4. `summary.external` distribution — off-heap pressure (Buffer, ArrayBuffer).
5. `heapSnapshotAnalysis` if enabled — retained-growth deltas.
6. Cross-reference `alloc-in-hot-path` findings with `profiles.cpu.hotspots` to find the highest-leverage fixes.

## Caveats

- **Startup phases inflate slopes.** A 30 s capture that includes 5 s of warm-up will report a slope that may not reflect steady-state behavior. Use `--wait-for-url` and `--capture-delay` to skip warm-up.
- **Sample interval matters.** With the default `512KiB`, allocations smaller than the interval are statistically sampled — small but frequent allocations will be visible, but a single small allocation may be invisible. Drop to `64KiB` when hunting subtle leaks.
- **Heap snapshots are heavy.** They double the resident memory peak briefly and write multi-MB files. Keep `--heap-snapshot-analysis` for targeted leak hunts, not as a default.
- **`memory-growth` on warm-up looks like a leak.** When integrity is good but the run was short, treat a single `memory-growth:*` finding as a hypothesis: rerun longer or after warm-up to confirm.
