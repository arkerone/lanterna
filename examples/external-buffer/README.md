# external-buffer-pressure example

A blob cache keeps decoded binary data in `Buffer`s. Buffers live **off-heap**,
outside V8's GC, so `heapUsed` stays small while `external` balloons — a leak
that never shows up in a heap snapshot. Lanterna raises `external-buffer-pressure`.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind memory --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id: "external-buffer-pressure"` once `external` is
  ≥ 0.5× `heapUsed` (≥ 1.5× escalates to `critical`).
- `profiles.memory.series.external` far above `series.heapUsed`.

## What to try next

- Bound the cache (evict old blobs) or stream the data instead of retaining it —
  `external` should plateau and the finding clear.
