# excessive-gc example

Per "request", `buildEphemeralGraph` allocates and immediately discards a large
graph of short-lived objects (the cross-references defeat escape analysis, so the
objects really hit the heap). The young generation floods and the garbage
collector eats a big share of CPU — a `excessive-gc` finding.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id: "excessive-gc"` (GC ≥ 10% of on-CPU time, or a
  longest pause ≥ 100ms).
- `profiles.cpu.gc` with elevated `totalPauseMs` / `longestPauseMs`.

## What to try next

- Reuse a pooled array of nodes instead of allocating a fresh graph each call,
  or bound the work — GC time should fall.
- Add `--kind cpu,memory` to correlate the churn with `large-allocator`.
