# Lanterna examples

Self-contained Node workloads that each exhibit a real performance pathology, one
per built-in detector. They're profiled **from the outside** by the `lanterna`
CLI — the scripts don't depend on Lanterna. No `npm install` is needed (the one
dependency, for the `node-modules-hotspot` example, is vendored).

Together they cover **all 19 built-in findings**, so they double as a living
verification suite: see [Verifying the whole detector suite](#verifying-the-whole-detector-suite).

## Coverage

| Example | Pathology | `--kind` | Findings produced | E2E tier |
| --- | --- | --- | --- | --- |
| [cpu-hotspot](./cpu-hotspot) | Sync `pbkdf2Sync` in an auth verify loop | `cpu` | `sync-crypto-on-hot-path` | stable |
| [cpu-user-hotspot](./cpu-user-hotspot) | Expensive pure user-code function | `cpu` | `cpu-hotspot` | stable |
| [json-on-hot-path](./json-on-hot-path) | Per-request `JSON.stringify` + `parse` | `cpu` | `json-on-hot-path` | stable |
| [node-modules-hotspot](./node-modules-hotspot) | A dependency dominates CPU | `cpu` | `node-modules-hotspot` | stable |
| [require-in-hot-path](./require-in-hot-path) | `require()` inside the request loop | `cpu` | `require-in-hot-path` | stable |
| [excessive-gc](./excessive-gc) | Per-request short-lived object churn | `cpu` | `excessive-gc` | stable |
| [deopt-loop](./deopt-loop) | Repeated V8 deopt of a hot function | `cpu` `--deep` | `deopt-loop` | best-effort |
| [event-loop-stall](./event-loop-stall) | Sync read + parse of a large file per tick | `cpu` | `blocking-io`, `event-loop-stall` | stable |
| [memory-leak](./memory-leak) | Unbounded response cache | `memory` | `memory-growth`, `large-allocator` | stable |
| [external-buffer](./external-buffer) | Off-heap `Buffer` cache dwarfs the heap | `memory` | `external-buffer-pressure` | stable |
| [long-await](./long-await) | Downstream call without a timeout | `cpu,async` | `long-await` | stable |
| [orphan-async](./orphan-async) | Async resources never cleaned up | `async` | `orphan-async-resource` | stable |
| [microtask-flood](./microtask-flood) | Unbounded async fan-out | `async` | `microtask-flood` | stable |
| [deep-async-chain](./deep-async-chain) | Recursion through awaited promises | `cpu,async` | `deep-async-chain` | best-effort |
| [async-latency](./async-latency) | Five distinct async latency causes | `cpu,async` | `event-loop-blocked-async` (+ cause classification) | stable |
| [hot-async-context](./hot-async-context) | CPU concentrated under one async root | `cpu,async` | `hot-async-context` | best-effort |
| [alloc-in-hot-path](./alloc-in-hot-path) | One frame is CPU-hot AND a top allocator | `cpu,memory` | `alloc-in-hot-path` | stable |
| [realistic-server](./realistic-server) | HTTP API with layered issues, under load | `cpu,memory` | `json-on-hot-path` (+ more) | stable |

`best-effort` means the detector depends on V8 trace timing or async/CPU correlation enough that the E2E suite warns instead of failing when the finding is missed on a particular machine. Agent reports surface these findings as caveated evidence; treat them as strong inspection leads, then corroborate with source and a rerun.

## Quick start

```bash
cd examples/cpu-hotspot
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

For agent-friendly output:

```bash
npx -y @lanterna-profiler/cli report report.json --format agent --output report.agent.md
```

Each example's `README.md` lists the exact command, the expected findings, and a
one-line fix to confirm the detection works.

## Verifying the whole detector suite

The examples are wired into an end-to-end test that runs each one through the
**locally built** CLI. Use it during development to confirm every detector still
behaves:

```bash
npm run test:e2e        # full suite from the repo root — builds first, then runs
npm run test:e2e:smoke  # CPU + memory + async smoke, attach, and agent contract
```

It checks four things:

1. **Positives** — each pathological workload produces its expected finding(s),
   at the expected `severity` / `confidence` where the manifest pins them.
2. **Negatives** — each corrected variant (`app.fixed.js`) does **not** produce
   the finding. This proves the documented fix works *and* that the detector
   isn't a false-positive machine.
3. **Attach mode** — `lanterna attach --pid` (the second capture path) also
   surfaces findings on a running process.
4. **Agent output** — the `--format agent` renderer emits the agent contract
   (`rerun_required`, the findings table, …).

This does real profiling (~5-6 min) and is **opt-in**: it's skipped in the normal
`npm test` and only runs when `LANTERNA_E2E=1` is set (the script sets it for you).

A separate, fast **coverage meta-test** (`examples.coverage.test.ts`) *does* run in
the normal `npm test`: it reads the real built-in detector registry and fails if
any detector is missing an example — so the 19/19 coverage stays honest as
detectors are added.

Everything is driven from one source of truth —
[`examples/manifest.mjs`](./manifest.mjs) (`EXAMPLES` + `FIXED_EXAMPLES`) — shared
by the table above and the tests in `packages/cli/test/`. Add an example + a
manifest entry and it's automatically verified.
