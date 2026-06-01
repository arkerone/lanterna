# Memory leak example — unbounded response cache

A Node script with a `store` Map that's never evicted, so every session record
(built by `buildSession`) is retained forever — the classic unbounded-cache leak.
Lanterna detects the sustained growth and ranks the dominant allocator.

## Run

From this directory:

```bash
# Memory profile only
npx -y @lanterna-profiler/cli run \
  --kind memory \
  --duration 30s \
  --output report.json \
  -- node app.js

# Memory + heap snapshot analysis (start vs end snapshot diff)
npx -y @lanterna-profiler/cli run \
  --kind memory \
  --heap-snapshot-analysis \
  --duration 30s \
  --output report.json \
  -- node app.js

npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- `findings[]` entries:
  - `memory-growth:rss` — the slope of `rssBytes` over the capture window is positive and large.
  - `memory-growth:heapUsed` — same on `heapUsedBytes`.
  - `large-allocator` — `buildSession` ranks at the top of `profiles.memory.hotAllocators[]`.
- With `--heap-snapshot-analysis`: `profiles.memory.heapSnapshotAnalysis.retainerPaths[]` should highlight the `store` Map retaining the session records.

## What to try next

- Bound `store` (evict by TTL or use an LRU) and re-run — `memory-growth` should drop or disappear.
- Combine with `--kind cpu --kind memory` to see the cross-kind `alloc-in-hot-path` finding flag the same allocator if it also dominates CPU.
