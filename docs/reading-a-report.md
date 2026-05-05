# Reading a Lanterna Report

This page is the **interpretation playbook**: in what order to read a `LanternaReport`, what each section tells you, and the most common mistakes when drawing conclusions. For the schema itself, see [report-schema.md](./report-schema.md). For per-kind detail, see [kinds/cpu.md](./kinds/cpu.md), [kinds/memory.md](./kinds/memory.md), and [kinds/async.md](./kinds/async.md). For source-map handling (mapping generated `file:line` back to original TypeScript or bundled sources), see [source-maps.md](./source-maps.md).

## At a glance

For a first pass, render the report before reaching for raw JSON:

```bash
lanterna report report.json --format text
lanterna report report.json --format markdown --output report.md
lanterna report report.json --format agent --output report.agent.md
```

Use `--format agent` when an AI agent or automation will consume the report. It preserves Lanterna finding order and turns the JSON into a fixed Markdown contract: `Capture`, `Signal Gate`, `Action Queue`, `Evidence Pack`, `Files To Read First`, `Decision Rules`, and `Next Commands`. Use `jq` after that only when you need exact fields, automation, or deeper schema inspection.

| # | Section | What it tells you | When to distrust it |
| --- | --- | --- | --- |
| 1 | `meta` | What was captured (mode, duration, `profileKinds`, integrity flags). | `durationMs` very short, or `captureIntegrity.*` flags `false`. |
| 2 | `profiles.cpu.quality` | Whether CPU evidence is strong enough to trust. | `confidence = low`, high idle, low samples, untimed samples. |
| 3 | `profiles.cpu.summary` | Where CPU time went (ratios, top category). | `idleRatio` > 0.8 — the profile is mostly idle. |
| 4 | `findings` | Prioritized hypotheses backed by the capture (tagged `profileKind`). | Empty `findings[]` does not prove a healthy profile. |
| 5 | `profiles.cpu.hotspots` | Where CPU is actually spent (self + inclusive). | A hot leaf in `node_modules` is usually a symptom, not a cause. |
| 6 | `profiles.cpu.eventLoop` | Latency signal + stall windows. | `confidence = low` or `measurementBasis = histogram` alone. |
| 7 | `profiles.cpu.gc` | Pause counts, duration, correlated hotspots. | Very short runs with no `gcTimed`. |
| 8 | `profiles.cpu.hotStacks` | Complete sampled call paths, weighted. | Only needed when a single hotspot is ambiguous. |
| 9 | `profiles.cpu.deopts` | V8 deoptimisation clusters. | Empty unless `meta.kinds.cpu.deep === true`. |
| 10 | `profiles.memory.*` | Allocators, RSS series, optional snapshot deltas. | Short captures inflate growth slopes; sample interval bounds visibility. |
| 11 | `profiles.async.*` | Experimental async chains, awaits, orphans, concurrency. | `quality.attachPartialCapture = true`, dropped events, low CDP stack coverage. |

`findings[]` is cross-kind at the root; each finding carries a required `profileKind` tag so you can filter.

## Common reading playbook

1. **Read `meta` and `captureIntegrity`** — sanity-check what you're about to interpret. Short `durationMs`, `controlChannel: false` in spawn mode, or missing `gcTimed` change how strongly you should weight downstream sections. See [signal-quality.md](./signal-quality.md).
2. **Read `profiles.cpu.quality`** before `findings[]` — a low-confidence profile can identify leads but not prove root causes.
3. **Filter `findings[]` by severity and `profileKind`** — start with `severity != "info"`; group by kind to know which specialist page to consult.
4. **Open the implicated source file** — `evidence.file` and `evidence.line` are where the action should happen. For some detectors that points at the user caller rather than a builtin callee.
5. **Cross-reference kinds when both were captured** — `alloc-in-hot-path` is the canonical example: a frame hot on CPU **and** in top allocators is the highest-leverage fix you can make.
6. **Use `hotStacks` only when a hotspot is ambiguous** — it surfaces the surrounding call path without manual reconstruction.

For the per-kind interpretation rules, see:

- [kinds/cpu.md](./kinds/cpu.md) — sections 1–9 in the table above.
- [kinds/memory.md](./kinds/memory.md) — section 10, slope interpretation, snapshot deltas.
- [kinds/async.md](./kinds/async.md) — section 11, quality of partial captures, instrumentation modes.

## Detector reference (cross-kind index)

The full catalog (with triggers and remediations) lives in [extending/detectors.md](./extending/detectors.md#built-in-findings). The short index:

| Detector id | Kind | One-line interpretation |
| --- | --- | --- |
| `sync-crypto-on-hot-path` | cpu | Synchronous crypto on the main thread. Switch to async or workers. |
| `blocking-io:<api>` | cpu | Sync `fs` / `child_process` / `zlib` on the hot path. Use the async equivalent. |
| `json-on-hot-path:<api>` | cpu | `JSON.parse` / `JSON.stringify` is a meaningful share of CPU. Cache, stream, or reduce. |
| `node-modules-hotspot:<package>` | cpu | A dependency dominates CPU. **Inspect the user caller path first.** |
| `excessive-gc` | cpu | GC ratio or longest pause is too high. Hunt allocations in top user hotspots. |
| `event-loop-stall` | cpu | The main thread stopped servicing tasks. Check `correlatedHotspots`. |
| `deopt-loop:<function>` | cpu | A hot function keeps deoptimising under `--deep`. Stabilise shapes/types. |
| `require-in-hot-path` | cpu | Module loading on the hot path. Hoist or memoize the lazy load. |
| `memory-growth:rss` / `memory-growth:heapUsed` | memory | Sustained linear growth ≥ 1 MB/s. Inspect top allocators and lifetimes. |
| `large-allocator:<frame>` | memory | A single frame owns ≥ 15 % of sampled allocations. |
| `external-buffer-pressure` | memory | Off-heap (`external`) dominates `heapUsed`. Look at Buffer/ArrayBuffer churn. |
| `alloc-in-hot-path:<frame>` | cross-kind | Frame hot on CPU **and** in top allocators — highest-leverage fix. |
| `deep-async-chain:<id>` | async | Async parent chain too deep — often accidental sequential `await`. |
| `long-await:<id>` | async | One `await` boundary is significantly longer than peers. |
| `orphan-async-resource` | async | Async resources started during capture and never resolved. |
| `microtask-flood` | async | Microtask volume crosses a per-window threshold (requires `--async-include-microtasks`). |
| `hot-async-context:<id>` | async | Same async context repeatedly entered — batch or memoize. |

### Fields that deserve extra care

#### `evidence.file` may point at the user caller

For some detectors (e.g. `sync-crypto-on-hot-path`, `blocking-io:<api>`), `evidence.file` is the user code that called into the builtin, not the builtin itself. That is intentional — it's where you actually edit code.

#### `proofLevel` separates evidence class from impact

`severity` estimates impact; `proofLevel` describes the evidence:

| Value | Meaning |
| --- | --- |
| `direct-sample` | A sampled CPU or heap frame directly supports the finding. |
| `correlated-window` | Timed windows or cross-signal correlation support the finding. |
| `trace-only` | Diagnostic trace output supports the finding; corroborate before patching. |
| `heuristic` | Derived trend or threshold evidence; useful as a lead, not proof. |

#### `event-loop-stall.correlatedHotspots`

When `measurementBasis === "histogram"`, `correlatedHotspots[]` is based on overall CPU overlap — not temporal overlap with stall windows. Read [signal-quality.md](./signal-quality.md#profilescpueventloop) before claiming causality.

#### `deopt-loop:<function>`

Fires only when a function is **both** hot in the CPU profile **and** repeatedly deoptimised under `--deep`. Focus on stabilising shapes and types, then reprofile. One-off deopt entries are noise.

#### `node-modules-hotspot:<package>`

A dependency hotspot is often a symptom — your code controls when and how often the dependency runs. Inspect the caller path, reduce input size or call frequency, and only then decide whether the dependency itself needs replacing.

## Common reading mistakes

> **Treating `topCategory` as a diagnosis.** `topCategory` is a summary, not a root cause. High `native` often just means CPU work happened below JS wrappers.

> **Assuming no findings means no problem.** Lanterna's detectors are heuristic. A clean `findings[]` lowers the odds of the usual issues; it does not prove the profile is healthy.

> **Blaming `node_modules` immediately.** A dependency hotspot is often just where the CPU landed. The caller path is usually your code.

> **Ignoring `idleRatio`.** A profile captured without real load can be technically valid but operationally misleading.

> **Skipping `profiles.cpu.quality`.** `summary` and `findings` can be mechanically valid while the profile is too short, too idle, or under-sampled for confident decisions.

> **Reading event-loop lag without reading confidence.** Always read `measurementBasis` and `confidence` alongside the lag numbers.

> **Treating a `memory-growth` finding from a startup-heavy capture as a leak.** Slopes computed across warm-up phases can be artificially steep. Rerun longer or after warm-up to confirm.

> **Treating async findings from attach mode as exhaustive.** `quality.attachPartialCapture = true` means resources before hook installation are invisible.

> **Treating low-confidence `userCaller` as the fix location.** `userCaller` is meant to explain how user code reached external work. When confidence is low, inspect that path before moving evidence or changing code.

## What to do after reading a report

1. Check `profiles.cpu.quality` and capture integrity.
2. Act on high-confidence `critical` findings first.
3. Inspect the top 5 hotspots / hotAllocators even if they did not trigger a finding.
4. If the run was mostly idle, rerun under representative load (`--workload`).
5. If you suspect JIT instability, rerun with `--deep`.
6. If you suspect a memory leak, rerun longer with `--kind memory --heap-snapshot-analysis`.
7. Read the actual source file named in `evidence.file` before making changes.

Want to understand *why* these fields and flags exist? Read [architecture.md](./architecture.md).
