# alloc-in-hot-path example

`buildReport` allocates a batch of row objects **and** sums over them, so the same
frame is both a top CPU hotspot and a top memory allocator. Lanterna's cross-kind
detector flags it as `alloc-in-hot-path` — fixing it pays twice (fewer cycles and
less GC pressure). Requires both the `cpu` and `memory` kinds.

The rows are kept in a small bounded ring buffer so they actually escape onto the
heap (otherwise V8 scalar-replaces them and nothing is sampled).

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind cpu,memory --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `alloc-in-hot-path:`, naming
  `buildReport` (or its caller `tick`) — the frame appears in both
  `profiles.cpu.hotspots` and `profiles.memory.hotAllocators`.

## What to try next

- Reuse a pre-allocated row pool instead of building fresh objects each call —
  the allocator pressure (and the cross-kind finding) goes away.
