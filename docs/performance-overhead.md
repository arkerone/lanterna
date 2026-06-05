# Performance overhead

Lanterna pays for its observability with two distinct costs: a fixed **startup cost** to spawn the inspector, install hooks and start probes, and a **steady-state cost** while the capture runs (V8 sampling, heap allocation profile, RSS sampling, control-channel emissions). This page quantifies both so you can plan capture windows and choose flags accordingly.

## TL;DR

- **Startup cost (spawn mode):** ~600 ms on Linux/x64. Constant — does not scale with capture duration.
- **CPU kind, steady-state:** ~1–2 % wall-time overhead on a CPU-bound workload at the default `--sample-interval` (1000 µs).
- **Memory kind, steady-state:** ~5–10 % wall-time overhead on an allocation-heavy workload at default `--heap-sample-interval` (512 KiB) and `--memory-usage-interval` (250 ms).
- **Attach mode:** zero startup cost; the inspector is already running in the target.

If you can run a representative load for ≥ 5 s, the steady-state cost dominates and overhead is in the single digits. For shorter captures, the fixed startup dominates and the percentage looks worse — that's a measurement artifact, not a profiler defect.

## Methodology

The numbers below come from [`bench/`](../bench) running on the development laptop. Reproduce locally with:

```bash
npm run build
npm run bench
```

Each mode runs `BENCH_RUNS` times (the committed snapshot used 5) in baseline (no Lanterna) and under each Lanterna mode; the median is reported. Micro wall time is measured around `child_process.spawn()` and includes child startup. Overhead is `(lanterna_median − baseline_median) / baseline_median`. The report is written to a temp directory and discarded — only the timing impact is measured.

Beyond the micro CPU/allocation scenarios, the harness also runs: an **in-process** scenario (`profileInProcess()` vs. baseline in the same process — the only scenario that reports peak RSS), and an **HTTP** scenario that drives `examples/realistic-server` under load across `cpu`, `memory`, `cpu,memory`, `cpu,async` (safe & full) spawn modes plus an `attach` mode, reporting throughput and p50/p95/p99 latency.

See [`bench/README.md`](../bench/README.md) for scenario details and tunable knobs.

## Latest numbers

All numbers below are one committed run — [`bench/baseline.json`](../bench/baseline.json) — on a Linux x64 dev laptop, Node v24.2.0, **5 runs per mode (median)**. They are single-machine and **load-sensitive**: profiler overhead depends on spare CPU headroom, so a quiet box shows less than these figures (captured on a busy laptop) and a saturated one shows more. Reproduce on your hardware with `npm run bench`; the **percentage**, not the absolute time, is what transfers.

### Micro — CPU & allocation wall time

| Scenario | Mode | Median (ms) | Overhead |
| --- | --- | ---: | ---: |
| cpu-fib (`fib(37)` × 20) | baseline | 4135 | — |
| cpu-fib | `--kind cpu` | 4729 | +14.4 % |
| cpu-fib | `--kind cpu --sample-interval 250` | 4775 | +15.5 % |
| cpu-fib | `--kind cpu --sample-interval 4000` | 4689 | +13.4 % |
| cpu-fib | `--kind cpu --deep` | 4858 | +17.5 % |
| cpu-fib | `--kind cpu,memory` | 4732 | +14.4 % |
| alloc-heavy (`Array(64)` × 25 M) | baseline | 3402 | — |
| alloc-heavy | `--kind memory` | 4289 | +26.1 % |
| alloc-heavy | `--kind memory --heap-snapshot-analysis` | 35058 | +930 % |

This overhead bundles the fixed ~600 ms spawn/inspector startup. On a ~4 s baseline that startup alone is ~14 %, which is why the sample-interval sweep barely moves the total — 250 µs (+15.5 %) vs 4000 µs (+13.4 %): **steady-state CPU sampling is near-free; what you pay is startup**. `--deep` adds a few points (deopt-trace I/O). `--heap-snapshot-analysis` is **seconds-scale** (a full heap snapshot + parse) — budget for it explicitly, never on a hot loop. For a startup-free overhead number, see the in-process table.

### In-process self-profiling — the clean steady-state + RSS number

`profileInProcess()` runs in the same process (no spawn), so it isolates the steady-state cost and is the one apples-to-apples **memory** measurement (`process.resourceUsage().maxRSS`).

| Mode | Median (ms) | Overhead | Peak RSS | RSS Δ |
| --- | ---: | ---: | ---: | ---: |
| baseline | 1251 | — | 89.7 MiB | — |
| `profileInProcess()` (cpu) | 1350 | +7.9 % | 96.6 MiB | +7.7 % |

On a short (~1.3 s) workload the +7.9 % is capture start/stop plus sampling, and the profiler's sample buffers add ~7 % RSS. Longer captures amortise the start/stop and trend toward the low-single-digit steady-state sampling cost.

### HTTP service under load — throughput & tail latency

The adoption-critical case: `examples/realistic-server` driven with concurrent POST traffic (8 s, concurrency 32, 5 runs), spawn modes plus an attach mode.

| Mode | RPS | RPS Δ | p50 (ms) | p95 (ms) | p99 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 4844 | — | 5.8 | 12.0 | 15.7 |
| `--kind cpu` | 4624 | −4.5 % | 6.0 | 12.5 | 15.9 |
| `--kind memory` | 4947 | +2.1 % | 5.7 | 12.4 | 16.1 |
| `--kind cpu,memory` | 4298 | −11.3 % | 6.6 | 13.6 | 17.0 |
| `--kind cpu,async` (safe) | 4240 | −12.5 % | 6.7 | 13.5 | 17.3 |
| `--kind cpu,async` (full) | 4405 | −9.1 % | 6.4 | 13.3 | 17.4 |
| `attach --kind cpu` | 4623 | −4.6 % | 6.1 | 13.0 | 16.2 |

Reading it (on this contended laptop):

- **One kind costs a few percent.** `cpu` ≈ −4.5 % throughput, and `attach --kind cpu` matches it (−4.6 %) — attaching to a live server is neither cheaper nor dearer than spawning it. `memory` alone is within run-to-run noise (+2.1 %).
- **Stacking kinds or adding async lands around 9–13 %.** `cpu,memory` and `cpu,async` (safe and full) sit in that band; safe and full are comparable on this workload (the small safe↔full ordering is inside the noise).
- **Tail latency rises modestly** — p99 from 15.7 ms to 16–17.4 ms.
- These are request-path throughput numbers, not the wall time of a batch job — use the micro table for that, and remember overhead shrinks with spare headroom.

## Overhead drivers

- **`--sample-interval` (default 1000 µs).** Lower values (e.g. 250 µs) capture rarer hot paths but quadruple the sampler's wake-ups. Increase to 2000 µs or 4000 µs for very hot CPU loops where you want minimal perturbation.
- **`--heap-sample-interval` (default 512 KiB).** Smaller values catch smaller allocators at the cost of higher overhead and larger profiles. Don't drop below 64 KiB unless you have a specific allocator hunt in mind.
- **`--memory-usage-interval` (default 250 ms, min 10 ms).** This is `process.memoryUsage()` polled on a timer. Going below 20 ms adds noticeable overhead on Linux without much extra signal.
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

- Numbers are single-machine; absolute times and RPS will vary, but **overhead percentages** are the meaningful comparison. Refresh the committed snapshot with `npm run bench:baseline` and guard against regressions with `npm run bench:check`.
- The startup cost mostly comes from inspector negotiation and CDP handshake. It is not optimized further today; if it becomes a constraint for short workloads, attach mode is the answer.
