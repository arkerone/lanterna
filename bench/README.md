# Lanterna overhead bench

A minimal harness for measuring the overhead Lanterna adds on top of unprofiled execution. Designed to be reproducible and fast enough to run on a developer laptop without a dedicated bench rig.

## Scenarios

- **cpu-fib** (micro) — recursive `fib(BENCH_FIB_N)` repeated `BENCH_FIB_ITERATIONS` times. Defaults to `fib(37)` x 20. Pure CPU. Modes: baseline, `lanterna-cpu`, a `--sample-interval` sweep (`-si250`, `-si4000`), `--deep` (deopt tracing), and combined `cpu,memory`.
- **alloc-heavy** (micro) — `BENCH_ALLOC_ITERATIONS` short-lived `Array(BENCH_ALLOC_PAYLOAD_SIZE)` allocations. Defaults to 25,000,000 x 64. Modes: baseline, `lanterna-memory`, and `lanterna-memory-heapsnapshot` (`--heap-snapshot-analysis`, which is seconds-scale by design).
- **in-process-cpu** — `profileInProcess()` vs. baseline on the same CPU workload, in the **same process**. The only scenario that reports **peak RSS** (`process.resourceUsage().maxRSS`), because in-process is the one apples-to-apples memory measurement (no separate CLI/child to skew it). It also isolates steady-state sampling overhead with no spawn/startup cost.
- **http-realistic-server** — starts `examples/realistic-server`, waits for `/health`, drives POST traffic with `bench/scenarios/http-load.mjs`, and reports throughput + p50/p95/p99 latency. Modes: baseline, `cpu`, `memory`, `cpu,memory`, `cpu,async` (safe & full) in spawn mode, and `lanterna-http-attach-cpu` (attach to the running server by pid — POSIX-only).

The micro scenarios run for ~1–3 seconds at default settings (the heap-snapshot mode adds seconds). The HTTP scenario defaults to 8 seconds per mode. Peak RSS is **only** measured for the in-process scenario; measuring the *target's* RSS from outside in spawn/attach mode is unreliable (an external timer sees the CLI process, not the profiled child), so it is not claimed there.

## Run

```bash
npm run build         # ensure the CLI is compiled
npm run bench         # runs all scenarios x 3 runs each
```

The output is Markdown: one table of median wall times and overhead percentages for micro scenarios, plus one HTTP throughput/latency table when HTTP benchmarking is enabled.

## Baseline and regression check

```bash
npm run bench:json       # same run, emitted as a compact JSON summary on stdout
npm run bench:baseline   # write that JSON to bench/baseline.json (the committed snapshot)
npm run bench:check      # run the bench and compare against bench/baseline.json
```

`bench/baseline.json` is the committed reference. `bench:check` compares the *relative* numbers a baseline is meant to protect — `overheadPct` for micro and in-process scenarios, `throughputDeltaPct` for HTTP — and prints a per-row comparison.

It is **non-gating by default** because machine variance makes hard gating flaky: it exits 0 and prints any drift. Pass `--strict` (or set `BENCH_CHECK_STRICT=1`) to exit non-zero when a number drifts past tolerance. Tolerances default to `BENCH_MICRO_TOLERANCE_PP=15` and `BENCH_HTTP_TOLERANCE_PP=10` (percentage points). Refresh the baseline on the same machine with `npm run bench:baseline` whenever the numbers legitimately move.

## Methodology

- Each micro scenario runs baseline (no Lanterna) and every configured Lanterna mode, `BENCH_RUNS` (default 3) times.
- Wall time is measured with `process.hrtime.bigint()` around `child_process.spawn()` — includes child startup. Micro overhead % therefore bundles the fixed ~600 ms spawn/inspector startup; at the default scenario sizes that is a single-digit-to-low-double-digit share. The in-process scenario has **no** spawn cost, so its overhead % is the cleanest steady-state sampling number.
- The Lanterna report is written to a temp directory and discarded; we only care about wall-time impact, not report contents.
- Overhead is reported as `(lanterna_median - baseline_median) / baseline_median`.
- The in-process scenario runs `bench/scenarios/in-process-workload.mjs` in `baseline` and `profile` modes and reports wall overhead plus peak-RSS delta.
- The HTTP scenario runs baseline plus the spawn modes and `lanterna-http-attach-cpu`, reporting median requests/sec, p50/p95/p99 latency, error count, and throughput delta vs. baseline.

## Knobs

| Variable | Default | Effect |
| --- | --- | --- |
| `BENCH_RUNS` | 3 | Number of runs per (scenario, mode) — increase to reduce noise. |
| `BENCH_FIB_N` | 37 | Recursion depth for cpu-fib. |
| `BENCH_FIB_ITERATIONS` | 20 | Outer loop count for cpu-fib. |
| `BENCH_ALLOC_ITERATIONS` | 25000000 | Outer loop count for alloc-heavy. |
| `BENCH_ALLOC_PAYLOAD_SIZE` | 64 | Per-iteration array size for alloc-heavy. |
| `BENCH_SKIP_HTTP` | unset | Set to `1` to skip the HTTP service benchmark. |
| `BENCH_HTTP_DURATION_MS` | 8000 | HTTP load duration per run/mode. |
| `BENCH_HTTP_CONCURRENCY` | 32 | Concurrent HTTP workers. |
| `BENCH_HTTP_PORT` | 7070 | Base port for the HTTP server; each repeated sample increments it. |
| `BENCH_SKIP_INPROC` | unset | Set to `1` to skip the in-process scenario. |
| `BENCH_INPROC_ITERATIONS` | 40 | Workload chunks for the in-process scenario. |
| `BENCH_INPROC_FIB` | 33 | `fib(n)` size per in-process workload chunk. |
| `BENCH_VERBOSE` | unset | Set to `1` to stream child stdout/stderr while benchmarking. |

## Caveats

- Measurements include child-process startup. At 1–3 second scenario duration that's a small constant; for shorter scenarios it dominates (hence the in-process scenario for a startup-free overhead number).
- Single-machine numbers; absolute values vary with hardware. The **overhead percentage** / **throughput delta** is the meaningful signal.
- HTTP numbers are local-machine measurements. Use throughput delta and p95/p99 movement more than absolute request counts.
- `bench:check` compares overhead in absolute percentage points. The huge-overhead modes (`-deep`, `-heapsnapshot`) are kept for documentation but their run-to-run variance can exceed the default tolerance — read them as "expensive, expected", not regressions.
- `lanterna-http-attach-cpu` relies on `SIGUSR1` (POSIX); on Windows that mode errors and is best skipped.
