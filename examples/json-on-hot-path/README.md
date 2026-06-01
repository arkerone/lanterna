# JSON on a hot path example

An API handler that `JSON.stringify`s an order to send downstream and then
`JSON.parse`s the response back — the classic "double JSON tax" on every
request. Lanterna flags the JSON work as a `json-on-hot-path` finding.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `json-on-hot-path:` (e.g.
  `json-on-hot-path:JSON.stringify`), pointing back at `handleRequest`.
- `profiles.cpu.hotspots` with significant inclusive time in the native
  `JSON.parse` / `JSON.stringify` frames.

## What to try next

- Parse once at the edge and pass the object around instead of re-serializing;
  the finding should drop.
- Add `--kind cpu,memory` to also surface the allocation pressure that large
  JSON payloads create.
