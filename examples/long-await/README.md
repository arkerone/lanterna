# long-await example

Each request `await`s a downstream call with no timeout that takes ~250ms — well
past the 100ms p99 latency budget. Lanterna ranks the longest-lived async
operations and raises a `long-await` finding anchored on the call site.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind cpu,async --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- One or more `findings[]` entries with `id` starting `long-await:`, each anchored
  on `slowDownstreamCall` / `handleRequest` (≥ 1000ms escalates to `critical`).
- `profiles.async.topOperations[]` sorted by duration.

## What to try next

- Add an `AbortController` timeout to `slowDownstreamCall` so slow calls reject
  fast — the long awaits disappear.

> `async` is experimental and opt-in (`--kind async`); see `docs/kinds/async.md`.
