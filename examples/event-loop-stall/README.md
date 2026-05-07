# Event-loop stall example — sync `readFileSync` on a tick

A Node script that re-reads `package-lock.json` synchronously on every interval tick. Each blocking read stalls the event loop; Lanterna picks up both the blocking I/O and the resulting event-loop lag.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 25s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `blocking-io` finding pointing at `readFileSync` inside `loadConfig`.
- An `event-loop-stall` finding with `eventLoop.histogram.p99Ms` and `maxMs` well above the stall threshold.
- `eventLoop.measurementBasis` set to `"heartbeats"` (spawn mode), and `correlatedHotspots[]` linking the stalls to `loadConfig`.

## What to try next

- Replace `readFileSync` with `await readFile(...)` from `node:fs/promises` — both findings should clear.
- Cache the file once outside the interval — even simpler fix; the event-loop histogram should flatten.
