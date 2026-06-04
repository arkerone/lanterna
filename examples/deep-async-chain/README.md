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

- A `findings[]` entry with `id` starting `deep-async-chain:`, anchored on
  `resolveLevel`, with a high chain **`recursionDepth`** — the same function
  repeated that many times in a resource's creation stack. The detector gates on
  `recursionDepth`, not the structural `depth`, so it measures real recursion, not
  how long the process ran. (`recursionDepth` is capped by `--async-stack-depth`,
  default 32, so a ~40-deep recursion reads as ~32 — already `critical`.)

> Chain reconstruction depends on `async_hooks` data quality, so the e2e suite
> treats this finding as best-effort.

## What to try next

- Convert the recursion-through-promises into an iterative loop, or run
  independent steps with `Promise.all` — the recursion depth collapses.
- `app.fixed.js` is the corrected shape: a sequential queue consumer
  (`while { await … }`). Its structural trigger `depth` still grows without bound,
  but nothing recurses (`recursionDepth` ≈ 1), so it produces **no**
  `deep-async-chain` finding — the common false positive this guards against. Run
  it the same way with `node app.fixed.js`.

> `async` is experimental and opt-in (`--kind async`); see `docs/kinds/async.md`.
