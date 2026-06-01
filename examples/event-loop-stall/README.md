# Event-loop stall example — sync read + parse on a tick

A Node script that synchronously reads a large (~40 MB) data file and
`JSON.parse`s it on every interval tick. Both the read and the parse block the
event loop, so other callbacks pile up; Lanterna picks up the blocking I/O and the
resulting event-loop lag.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 25s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `blocking-io:fs.readFileSync` finding pointing at `loadCatalog`.
- An `event-loop-stall` finding with `eventLoop.p99LagMs` / `maxLagMs` well above
  the stall threshold (the JSON parse is the long synchronous block).
- `eventLoop.measurementBasis` reflecting heartbeat data (spawn mode), with the
  stall correlated to `loadCatalog`.

## What to try next

- Read + parse the file once at startup (cache it) instead of per tick — both
  findings should clear and the histogram flattens.
- Move the work to `await readFile(...)` plus a streaming JSON parser to keep the
  loop responsive.
