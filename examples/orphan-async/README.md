# orphan-async-resource example

Each "job" schedules a long retry timer but the cleanup path is missing, so
hundreds of async resources are created and never destroyed. Lanterna detects the
pile-up as `orphan-async-resource` and points at the leaking init frame.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind async --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id: "orphan-async-resource"` (≥ 50 resources older
  than 1s; ≥ 500 escalates to `critical`), with `startJob` as the dominant init
  frame.

## What to try next

- Track and `clearTimeout` the retry timers (or use `AbortSignal.timeout`) so the
  resources resolve — the orphan count drops.

> `async` is experimental and opt-in (`--kind async`); see `docs/kinds/async.md`.
