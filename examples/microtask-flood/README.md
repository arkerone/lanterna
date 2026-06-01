# microtask-flood example

Every tick launches hundreds of fire-and-forget async tasks with no concurrency
cap, so the backlog never drains — the async equivalent of thread-pool
saturation. Lanterna raises `microtask-flood` from the sustained inflight count.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind async --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id: "microtask-flood"` (mean inflight ≥ 200; peak
  ≥ 2000 escalates to `critical`).
- `profiles.async.summary.concurrency` with a high `meanInflight` / `maxInflight`.

## What to try next

- Cap fan-out with a semaphore / `p-limit` and `await` the batch before launching
  the next — the inflight count stays bounded.

> `async` is experimental and opt-in (`--kind async`); see `docs/kinds/async.md`.
