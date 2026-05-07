# Memory leak example — unbounded cache with closure retainer

A Node script that grows a `Map<string, () => string>` indefinitely. Each entry holds a heavy string via closure, defeating naive GC. Lanterna detects sustained growth and ranks the allocator.

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
  - `large-allocator` — `cacheLine` (or its inlined site) ranks at the top of `profiles.memory.allocators[]`.
- With `--heap-snapshot-analysis`: `profiles.memory.heapSnapshotAnalysis.retainers[]` should highlight the `cache` Map and the closure wrapper.

## What to try next

- Add `cache.delete(...)` after a TTL and re-run — `memory-growth` should drop or disappear.
- Combine with `--kind cpu --kind memory` to see the cross-kind `alloc-in-hot-path` finding flag the same allocator if it also dominates CPU.
