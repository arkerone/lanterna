# Async latency example — one script, five latency causes

A Node script that repeatedly triggers five distinct async latency patterns so you can see how Lanterna decomposes latency (`waitMs` / `scheduleDelayMs` vs `runMs`) and classifies its **root cause** per operation.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --kind cpu,async --duration 20s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

In `profiles.async.topOperations[]`, operations classified by `latencyCause`. The reliably-classified cases:

- **`event-loop-blocked`** — a timer scheduled for ~30ms that fires ~350ms late because a synchronous busy-loop blocked the event loop. Its `waitMs` is large, `runMs` ~0, and a top-level **`event-loop-blocked-async`** finding points at `blockLoopFor` (the synchronous culprit), *not* the timer.
- **`cpu-bound`** — `cpuBoundCase` where `runMs` ≈ `durationMs` (the awaited work is CPU, not waiting).
- **`io-wait`** — the `fs.readFile` of `package-lock.json` (kind `fs`, when no loop stall overlaps it).

Two cases deliberately show the **limits** of cause classification (see [docs/kinds/async.md](../../docs/kinds/async.md) → Caveats):

- **`downstreamCase`** does **not** become `downstream-async`. It awaits `inner()`'s 250ms timer, but a timer only *waits* — it never *runs* — so there are no descendant run windows to overlap. It typically shows as **`unknown`**. `downstream-async` only fires when a trigger-descendant burns CPU during the parent's wait.
- **`gcCase`** rarely becomes `gc-pause`. GC pauses are matched against their real (mostly sub-millisecond) durations, so they seldom cover ≥50% of a wait. Expect **`cpu-bound`** (allocation is CPU) or **`unknown`**.

Also inspect:

- `profiles.async.summary.byKindLatency` — per-family p50/p95/p99 and `meanWaitMs`.
- `profiles.async.quality.clockSyncUncertaintyMs` — small but non-zero (CPU↔async clock anchoring is active).
- `profiles.async.quality.attributedStackRatio` / `ambiguousRatio`.

## Inspect the JSON directly

```bash
jq '.profiles.async.topOperations[] | {kind, durationMs, waitMs, scheduleDelayMs, runMs, latencyCause, causeConfidence, attributedFrameOrigin}' report.json
jq '.profiles.async.summary.byKindLatency' report.json
jq '.findings[] | select(.category=="event-loop-blocked-async")' report.json
```

## What to try next

- Replace `blockLoopFor(350)` with `await new Promise(r => setTimeout(r, 350))` — the `event-loop-blocked` cause and the `event-loop-blocked-async` finding should clear.
- Move `cpuBoundCase`'s loop to a worker thread — its operation should drop out of the CPU-bound bucket.
