# Performance overhead

Lanterna pays for its observability with two distinct costs: a fixed **startup cost** to spawn the inspector, install hooks and start probes, and a **steady-state cost** while the capture runs (V8 sampling, heap allocation profile, RSS sampling, control-channel emissions). This page quantifies both so you can plan capture windows and choose flags accordingly.

## TL;DR

- **Startup cost (spawn mode):** ~600 ms on Linux/x64. Constant — does not scale with capture duration.
- **CPU kind, steady-state:** ~1–2 % wall-time overhead on a CPU-bound workload at the default `--sample-interval` (1000 µs).
- **Memory kind, steady-state:** ~5–10 % wall-time overhead on an allocation-heavy workload at default `--heap-sample-interval` (512 KiB) and `--memory-usage-interval` (50 ms).
- **Attach mode:** zero startup cost; the inspector is already running in the target.

If you can run a representative load for ≥ 5 s, the steady-state cost dominates and overhead is in the single digits. For shorter captures, the fixed startup dominates and the percentage looks worse — that's a measurement artifact, not a profiler defect.

## Methodology

The numbers below come from [`bench/`](../bench) running on the development laptop. Reproduce locally with:

```bash
npm run build
npm run bench
```

Each scenario runs 3 times in baseline (no Lanterna) and 3 times under Lanterna. Wall time is measured around `child_process.spawn()` and includes child startup. Overhead is reported as `(lanterna_median − baseline_median) / baseline_median`. The harness writes the report to a temp directory and discards it — only wall-time impact is measured.

See [`bench/README.md`](../bench/README.md) for scenario details and tunable knobs.

## Latest numbers

| Scenario | Mode | Median (ms) | Overhead | Notes |
| --- | --- | ---: | ---: | --- |
| cpu-fib (recursive `fib(37)` × 20) | baseline | 4515 | — | Pure CPU, no allocations |
| cpu-fib | `lanterna run --kind cpu` | 5181 | +14.8 % | Includes ~600 ms startup |
| alloc-heavy (`Array(64)` × 25 M) | baseline | 3818 | — | GC-pressure workload |
| alloc-heavy | `lanterna run --kind memory` | 4734 | +24.0 % | Includes ~600 ms startup |

Hardware: Linux x64, Node v24.2.0, 3 runs per mode.

### Reading the numbers

The reported overhead bundles a fixed-cost startup with a per-millisecond steady-state cost. Subtract ~600 ms from the Lanterna-mode column and the remainder is what the capture actually costs:

- **cpu-fib:** 5181 − 4515 ≈ 666 ms over baseline. ~600 ms is startup → ~66 ms (~1.5 %) is steady-state CPU sampling.
- **alloc-heavy:** 4734 − 3818 ≈ 916 ms over baseline. ~600 ms is startup → ~316 ms (~8 %) is steady-state heap-sampling + RSS observation.

Captures longer than ~5 s should see the steady-state numbers; shorter captures will see a worse overall percentage because of the fixed startup.

## Overhead drivers

- **`--sample-interval` (default 1000 µs).** Lower values (e.g. 250 µs) capture rarer hot paths but quadruple the sampler's wake-ups. Increase to 2000 µs or 4000 µs for very hot CPU loops where you want minimal perturbation.
- **`--heap-sample-interval` (default 512 KiB).** Smaller values catch smaller allocators at the cost of higher overhead and larger profiles. Don't drop below 64 KiB unless you have a specific allocator hunt in mind.
- **`--memory-usage-interval` (default 50 ms).** This is `process.memoryUsage()` polled on a timer. Going below 20 ms adds noticeable overhead on Linux without much extra signal.
- **`--heap-snapshot-analysis`.** Heap snapshots are expensive (seconds, not milliseconds, and proportional to heap size). The bench above does **not** include this flag.
- **`--async-instrumentation full`.** The full async transform rewrites `await` sites at load time. It's experimental and adds a one-off cost per loaded module. `safe` (default) is the cheap path.
- **`--deep` (run mode only).** Adds `--trace-deopt`. The runtime cost is small but stderr volume can dominate I/O on noisy targets.

## Choosing a low-overhead capture

For production-style profiling where you cannot afford double-digit overhead:

```bash
lanterna run \
  --kind cpu \
  --sample-interval 2000 \
  --duration 30s \
  --wait-for-url http://127.0.0.1:3000/health \
  --workload "your-load-tool" \
  -- node server.js
```

For a leak hunt where you can tolerate higher overhead but need fidelity:

```bash
lanterna run \
  --kind memory \
  --heap-sample-interval 64KiB \
  --heap-snapshot-analysis \
  --duration 60s \
  -- node app.js
```

For an attach against a live process where startup cost is zero but capture still costs cycles:

```bash
lanterna attach --pid <pid> --duration 30s
```

## Scope and known gaps

- HTTP / async scenarios are not yet covered. The numbers above don't capture request-path tail latency under load — that needs a server bench with an external load generator (e.g. `autocannon`). On the TODO list.
- Numbers are single-machine; absolute times will vary, but **overhead percentages** are the meaningful comparison.
- The startup cost mostly comes from inspector negotiation and CDP handshake. It is not optimized further today; if it becomes a constraint for short workloads, attach mode is the answer.
