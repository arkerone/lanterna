# Lanterna overhead bench

A minimal harness for measuring the overhead Lanterna adds on top of unprofiled execution. Designed to be reproducible and fast enough to run on a developer laptop without a dedicated bench rig.

## Scenarios

- **cpu-fib** — recursive `fib(BENCH_FIB_N)` repeated `BENCH_FIB_ITERATIONS` times. Defaults to `fib(37)` x 20. Pure CPU, no allocations, no I/O. Exercises the V8 sampling profiler hot path.
- **alloc-heavy** — `BENCH_ALLOC_ITERATIONS` short-lived `Array(BENCH_ALLOC_PAYLOAD_SIZE)` allocations. Defaults to 25,000,000 x 64. Exercises the heap allocation profile and `process.memoryUsage()` sampling cadence.
- **http-realistic-server** — starts `examples/realistic-server`, waits for `/health`, drives POST traffic with `bench/scenarios/http-load.mjs`, and reports throughput plus p50/p95/p99 latency. Exercises server readiness, workload orchestration, and async safe/full instrumentation overhead under request load.

The micro scenarios run for ~1–3 seconds at default settings. The HTTP scenario defaults to 8 seconds per mode.

## Run

```bash
npm run build         # ensure the CLI is compiled
npm run bench         # runs all scenarios x 3 runs each
```

The output is Markdown: one table of median wall times and overhead percentages for micro scenarios, plus one HTTP throughput/latency table when HTTP benchmarking is enabled.

## Methodology

- Each micro scenario runs in baseline (no Lanterna) and its configured Lanterna mode, `BENCH_RUNS` (default 3) times. The current modes are `lanterna-cpu` for `cpu-fib` and `lanterna-memory` for `alloc-heavy`.
- Wall time is measured with `process.hrtime.bigint()` around `child_process.spawn()` — includes child startup.
- The Lanterna report is written to a temp directory and discarded; we only care about wall-time impact, not report contents.
- Overhead is reported as `(lanterna_median - baseline_median) / baseline_median`.
- The HTTP scenario runs baseline plus `lanterna-http-cpu`, `lanterna-http-memory`, `lanterna-http-cpu-memory`, `lanterna-http-async-safe`, and `lanterna-http-async-full`. It reports median requests/sec, p50/p95/p99 latency, error count, and throughput delta vs. baseline.

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
| `BENCH_VERBOSE` | unset | Set to `1` to stream child stdout/stderr while benchmarking. |

## Caveats

- Measurements include child-process startup (~50ms on Linux). At 1–3 second scenario duration that's a small constant; for shorter scenarios it would dominate.
- Single-machine numbers; absolute values vary with hardware. The **overhead percentage** is the meaningful signal.
- HTTP numbers are local-machine measurements. Use throughput delta and p95/p99 movement more than absolute request counts.
