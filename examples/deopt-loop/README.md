# deopt-loop example

`accumulate` is JIT-compiled assuming a stable element kind, but it's fed arrays
whose element kind keeps changing (smi → double → object-with-`valueOf`). V8
discards the optimized code and re-optimizes repeatedly — a deoptimization loop.

Deopt tracing requires **`--deep`** (it parses `--trace-deopt` output) and is
**spawn-only** (not available in `attach` mode).

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --deep --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `deopt-loop:accumulate`, with a
  deopt `count` ≥ 3 (≥ 10 escalates to `critical`).
- `profiles.cpu.deopts[]` populated with the bailout reasons.

> Deopt behaviour is V8-version-dependent; on some Node builds this finding is
> less deterministic, which is why the e2e suite treats it as best-effort.

## What to try next

- Make `accumulate` monomorphic by only ever passing it `number` arrays — the
  deopt loop should stop.
