# hot-async-context example

All work flows through one async entry point (`handleJob`), and the CPU burned in
its awaited continuations is attributed back to that chain root. Lanterna's
cross-kind correlation (CPU samples × async run windows) raises
`hot-async-context` — the call site to optimize first.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind cpu,async --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `hot-async-context:`, attributing
  ≥ 10% of CPU to the `handleJob` chain (≥ 30% escalates to `critical`).

> CPU↔async correlation depends on clock anchoring and sampling, so the e2e suite
> treats this finding as best-effort.

## What to try next

- Move `heavyCompute` to a worker thread, or cache/batch its result — the CPU
  attributed to the async chain drops.

> `async` is experimental and opt-in (`--kind async`); see `docs/kinds/async.md`.
