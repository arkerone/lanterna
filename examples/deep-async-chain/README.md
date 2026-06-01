# deep-async-chain example

`resolveLevel` awaits itself ~40 levels deep — recursion through promises, the
kind of accidental depth you get walking a nested structure with an `await` at
each level. Lanterna detects the deep trigger chain as `deep-async-chain`.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind cpu,async --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `deep-async-chain:`, with a chain
  `depth` ≥ 30 (≥ 100 escalates to `critical`), rooted in `resolveLevel`.

> Chain reconstruction depends on `async_hooks` data quality, so the e2e suite
> treats this finding as best-effort.

## What to try next

- Flatten the recursion into an iterative loop, or run independent steps with
  `Promise.all` — the chain depth collapses.

> `async` is experimental and opt-in (`--kind async`); see `docs/kinds/async.md`.
