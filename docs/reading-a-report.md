# Reading a Lanterna Report

Lanterna emits a structured `LanternaReport` (schema v2). This guide walks through each section — **in reading order** — and how to interpret it.

> **Schema v2 convention.** Per-kind analysis output lives under `report.profiles.<kind>.*`. Built-in kinds are `cpu`, `memory`, and experimental `async`; every CPU field named below without an explicit path is short-hand for `report.profiles.cpu.<field>`. `findings[]` is cross-kind at the root; each finding carries a required `profileKind` tag. `meta.profileKinds` lists the kinds that successfully produced capture data in this report.

## At a glance

For a first pass, render the report before reaching for raw JSON:

```bash
lanterna report report.json --format text
lanterna report report.json --format markdown --output report.md
```

Use `jq` after that when you need exact fields, automation, or deeper schema inspection.

| # | Section | What it tells you | When to distrust it |
| --- | --- | --- | --- |
| 1 | `meta` | What was captured (mode, duration, `profileKinds`, integrity flags). | `durationMs` very short, or `captureIntegrity.*` flags `false`. |
| 2 | `profiles.cpu.quality` | Whether CPU evidence is strong enough to trust. | `confidence = low`, high idle, low samples, or untimed samples. |
| 3 | `profiles.cpu.summary` | Where CPU time went (ratios, top category). | `idleRatio` > 0.8 — the profile is mostly idle. |
| 4 | `findings` | Prioritized hypotheses backed by the capture (tagged `profileKind`). | Empty `findings[]` does not prove a healthy profile. |
| 5 | `profiles.cpu.hotspots` | Where CPU is actually spent (self + inclusive). | A hot leaf in `node_modules` is usually a symptom, not a cause. |
| 6 | `profiles.cpu.eventLoop` | Latency signal + stall windows. | `confidence = low` or `measurementBasis = histogram` alone. |
| 7 | `profiles.cpu.gc` | Pause counts, duration, correlated hotspots. | Very short runs with no `gcTimed`. |
| 8 | `profiles.cpu.hotStacks` | Complete sampled call paths, weighted. | Not always needed — use when a single hotspot is ambiguous. |
| 9 | `profiles.cpu.deopts` | V8 deoptimisation clusters. | Empty unless `meta.kinds.cpu.deep === true`. |
| 10 | `profiles.async.*` | Experimental async chains, long awaits, orphan resources, and concurrency when `--kind async` was selected. | `quality.attachPartialCapture = true`, high dropped records, or low CDP stack coverage. |

---

## 1. `meta` - what was captured

| Field | Meaning |
| --- | --- |
| `durationMs` | Wall-clock duration of the capture. |
| `command` | The executed command, or `[]` in attach mode. |
| `mode` | `"spawn"` or `"attach"`. |
| `profileKinds` | Profile kinds that produced capture data, in declared order (e.g. `["cpu"]`). |
| `kinds` | Per-kind meta contributions. CPU lives under `meta.kinds.cpu` (see below). |
| `captureIntegrity` | Quality indicators for timed signals (and per-kind under `captureIntegrity.kinds.<id>`). |

Per-kind CPU fields under `meta.kinds.cpu`:

| Field | Meaning |
| --- | --- |
| `samplesTotal` | Number of V8 tick samples collected. |
| `sampleIntervalMicros` | V8 CPU sampling interval. |
| `deep` | Whether deopt tracing was enabled. |

Sanity-check pattern:

- Short `durationMs` → treat ratios and rankings as less stable.
- `captureIntegrity.controlChannel = false` in `spawn` mode → event-loop and GC timing likely degraded.
- In `attach` mode, `controlChannel = false` is **expected** (no FD 3 channel).
- `meta.kinds.cpu.deep === false` → ignore `deopts[]` entirely.
- `meta.kinds.async.*` and `captureIntegrity.kinds.async.*` exist only for `--kind async`; in attach mode expect async quality to report partial capture for preexisting resources.

---

## 2. `quality` - how much to trust CPU evidence

`profiles.cpu.quality` summarizes whether the CPU section is strong enough to support confident decisions.

| Field | Meaning |
| --- | --- |
| `confidence` | `high`, `medium`, or `low` overall CPU-profile confidence. |
| `sampleCount` | Samples used for hotspot and ratio analysis. |
| `durationMs` | Capture duration used for confidence scoring. |
| `idleRatio` | Same value as `summary.idleRatio`, repeated for quick triage. |
| `samplesTimed` | Whether V8 supplied per-sample timing deltas. |
| `durationBasis` | `timeDeltas` when hotspot ms use V8 timings; `sampleInterval` when estimated. |
| `reasons[]` | Why confidence was degraded. |
| `recommendations[]` | How to improve or interpret the capture. |

Interpretation rules:

- `confidence = high` → rankings and percentages are usually safe to act on after reading source.
- `confidence = medium` → useful for prioritization, but avoid over-optimizing close calls.
- `confidence = low` → treat findings as leads. Say what rerun would improve the signal.
- If `durationBasis = sampleInterval`, trust `selfPct` / `totalPct` before `selfMs` / `totalMs`.

---

## 3. `summary` - where CPU time went

| Field | Meaning |
| --- | --- |
| `onCpuRatio` | Fraction of samples where the process was doing work. |
| `userCodeRatio` | On-CPU time in user code. |
| `nodeModulesRatio` | On-CPU time in dependencies. |
| `builtinRatio` | On-CPU time in Node builtins. |
| `nativeRatio` | On-CPU time in V8 / native frames. |
| `gcRatio` | On-CPU time spent in garbage collection. |
| `idleRatio` | Fraction of samples spent idle. |
| `topCategory` | Dominant non-idle category. |
| `dominantBlockingKind` | Coarse summary derived from emitted findings. |

Common patterns:

- **High `userCodeRatio`** → hotspots are likely actionable directly.
- **High `builtinRatio`** → often a sync builtin (crypto, fs, child process, zlib).
- **High `nativeRatio`** → the real CPU work sits below JS wrappers; look at callers and findings, not just the leaf.
- **High `gcRatio`** → memory churn is part of the problem.
- **High `idleRatio`** → the run may not represent the real hot path.

---

## 4. `findings` - the action queue

Each finding contains:

| Field | Purpose |
| --- | --- |
| `id` | Detector-specific identifier. |
| `profileKind` | Which profile kind emitted the finding (e.g. `"cpu"`). |
| `severity` | `critical` / `warning` / `info`. |
| `category` | Grouping for filtering. |
| `title` | Short human label. |
| `confidence` | Finding-level confidence (`high`, `medium`, or `low`) when supplied. |
| `proofLevel` | Evidence class: `direct-sample`, `correlated-window`, `trace-only`, or `heuristic`. |
| `evidence` | File, line, function, CPU weight, detector-specific `extra`. |
| `why` | Why this pattern matters. |
| `suggestion` | Concrete remediation hint. |
| `references` | Links to docs or related findings. |

Read `findings[]` as **prioritized hypotheses backed by the capture**. Filter by `profileKind` when multiple kinds are captured.

### Evidence attribution

The most useful part is usually `evidence`:

- `file`, `line`, `function` - where Lanterna believes the action should happen.
- `selfPct` - CPU weight attributed to that evidence.
- `extra` - detector-specific metadata.

For some detectors, `evidence.file` points to the **user caller** rather than the builtin callee. That is intentional - it's where you actually edit code.

<details>
<summary><strong><code>proofLevel</code> - how strong is the claim?</strong></summary>

| Value | Meaning |
| --- | --- |
| `direct-sample` | A sampled CPU or heap frame directly supports the finding. |
| `correlated-window` | Timed windows or cross-signal correlation support the finding. |
| `trace-only` | Diagnostic trace output supports the finding; corroborate before patching. |
| `heuristic` | Derived trend or threshold evidence; useful as a lead, not proof. |

</details>

Older reports may only have detector-specific `evidence.extra.proofLevel` values such as `direct-builtin`, `attributed-caller`, `aggregate-correlation`, or `deopt-trace-only`. Prefer the top-level `proofLevel` when present.

### Detector reference

| Detector id | Interpretation | Typical next step |
| --- | --- | --- |
| `sync-crypto-on-hot-path` | Synchronous crypto on the main thread. | Switch to async crypto or move to worker threads. |
| `blocking-io:<api>` | Synchronous fs / child-process / zlib on the hot path. | Replace with the async equivalent, or move off the request path. |
| `json-on-hot-path:<api>` | `JSON.parse` / `JSON.stringify` is a meaningful part of the request path. | Cache stable payloads, stream large ones, reduce repeated work. |
| `node-modules-hotspot:<package>` | A dependency dominates a meaningful share of CPU. | Inspect the user caller path first. See below. |
| `excessive-gc` | Too much on-CPU time in GC, or a pause long enough to matter. | Inspect top user hotspots for allocation patterns. |
| `event-loop-stall` | Main thread stopped servicing tasks for too long. | See below. |
| `deopt-loop:<function>` | A hot function keeps deoptimising under `--deep`. | See below. |
| `require-in-hot-path` | Module loading during active work, not just startup. | Hoist the import or memoize the lazy load. |

A few detectors deserve extra care:

#### `event-loop-stall`

Correlation candidates indicate which user hotspots overlapped the measured stall windows - not a proof that a single line caused the stall. Inspect the top correlated user hotspot first, then the hottest user function overall. If `measurementBasis = histogram` alone, `correlatedHotspots` is based on overall CPU overlap, not temporal overlap.

#### `deopt-loop:<function>`

Fires only when a function is **both** hot in the CPU profile **and** repeatedly deoptimised under `--deep`. Focus on stabilising shapes and types, then reprofile. One-off deopt entries are noise.

#### `node-modules-hotspot:<package>`

A dependency hotspot is often a symptom - your code controls when and how often the dependency runs. Inspect the caller path, reduce input size or call frequency, and only then decide whether the dependency itself needs replacing.

---

## 5. `hotspots` - where CPU is actually spent

| Field | Meaning |
| --- | --- |
| `selfMs` / `selfPct` | Direct time in this function. |
| `totalMs` / `totalPct` | Inclusive time, including children. |
| `callers[]` | Who invoked it. |
| `callees[]` | What it invoked. |
| `category` | Classification (`user`, `node_modules`, `node:builtin`, …). |
| `optimizationState` | V8 state (optimised, not-optimised, deopted, …). |

How to read it:

- Use `selfPct` to find the hottest direct leaves.
- Use `totalPct` to find broad expensive paths where work happens in descendants or native code.
- Use `callers[]` when a builtin or dependency is hot - the caller is often the real source fix.
- Use `selfMs` / `totalMs` as timed measurements only when `profiles.cpu.quality.durationBasis === "timeDeltas"`.

---

## 6. `eventLoop` - latency signal

Tells you whether CPU pressure translated into event-loop delay.

| Field | Meaning |
| --- | --- |
| `available` | Whether a usable event-loop signal exists. |
| `measurementBasis` | `both` (strongest), `heartbeats`, `histogram`, or `none`. |
| `confidence` | `high` / `low` / `none`. |
| `maxLagMs`, `p99LagMs`, `p50LagMs`, `meanLagMs` | Lag percentiles. |
| `stallIntervals` | When the main thread stopped picking up work. |
| `correlatedHotspots` | User hotspots whose sampled CPU overlapped those windows. |

Interpretation rules:

- `available = false` → no usable signal for this run.
- `both` is strongest; `heartbeats` or `histogram` alone are useful but weaker.
- Correlation is **strong evidence for investigation**, not proof that one line explains the entire stall.
- If the top candidate has weak overlap or confidence is low, inspect the broader hotspot list.

---

## 7. `gc` - allocation pressure and pauses

| Field | Meaning |
| --- | --- |
| `totalPauseMs` | Cumulative pause time. |
| `count` | Scavenge / mark-sweep counts. |
| `longestPauseMs` | Longest single pause observed. |
| `pausesOver10ms` | Detailed list of pauses exceeding 10 ms (`atMs`, `kind`, `durationMs`). |
| `correlatedHotspots` | User hotspots ranked by overlap with GC windows. |

How to interpret it:

- Frequent short pauses → allocation churn.
- A long `markSweep` pause → old-space pressure or retained memory.
- Correlated hotspots give you a ranked starting point for allocation analysis.

What to inspect in code:

- Repeated object churn in hot loops.
- Unbounded caches.
- Large `Buffer.concat` usage.
- Repeated `JSON.parse` / `JSON.stringify`.

---

## 8. `hotStacks` - sampled call paths

Useful when a single hotspot is not enough.

| Field | Meaning |
| --- | --- |
| `weightPct` | Share of samples this exact stack represents. |
| `frames[]` | Complete stack, leaf → root. |

Use hot stacks when:

- Multiple callers feed the same builtin.
- A dependency hotspot could be triggered by several different routes.
- You want the surrounding path without manually reconstructing it from callers/callees.

---

## 9. `deopts` - V8 JIT instability

Populated only when `meta.kinds.cpu.deep === true`.

| Field | Meaning |
| --- | --- |
| `function` / `file` / `line` | Where the deopt happened. |
| `reason` / `bailout` | V8's reason for deoptimising. |
| `count` | How many times Lanterna saw this deopt. |
| `explanation` | Human-readable note. |

How to use it:

- Focus on **repeated** entries, not one-off noise.
- Compare deopted functions to the hotspot list - a function that is both hot and repeatedly deoptimised is usually worth fixing.

---

## Common reading mistakes

> [!WARNING]
> **Treating `topCategory` as a diagnosis.** `topCategory` is a summary, not a root cause. High `native` often just means CPU work happened below JS wrappers.

> [!WARNING]
> **Assuming no findings means no problem.** Lanterna's detectors are heuristic. A clean `findings[]` lowers the odds of the usual issues; it does not prove the profile is healthy.

> [!WARNING]
> **Blaming `node_modules` immediately.** A dependency hotspot is often just where the CPU landed. The caller path is usually your code.

> [!WARNING]
> **Ignoring `idleRatio`.** A profile captured without real load can be technically valid but operationally misleading.

> [!WARNING]
> **Skipping `profiles.cpu.quality`.** `summary` and `findings` can be mechanically valid while the profile is too short, too idle, or under-sampled for confident decisions.

> [!WARNING]
> **Reading event-loop lag without reading confidence.** Always read `measurementBasis` and `confidence` alongside the lag numbers.

---

## What to do after reading a report

1. Check `profiles.cpu.quality` and capture integrity.
2. Act on high-confidence `critical` findings first.
3. Inspect the top 5 hotspots even if they did not trigger a finding.
4. If the run was mostly idle, rerun under representative load.
5. If you suspect JIT instability, rerun with `--deep`.
6. Read the actual source file named in `evidence.file` before making changes.

Want to understand *why* these fields and flags exist? Read [how-lanterna-works.md](how-lanterna-works.md).
