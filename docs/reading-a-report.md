# Reading a Lanterna Report

Lanterna emits a structured `LanternaReport`. This guide walks through each section - **in reading order** - and how to interpret it.

## At a glance

| # | Section | What it tells you | When to distrust it |
| --- | --- | --- | --- |
| 1 | `meta` | What was captured (mode, duration, integrity flags). | `durationMs` very short, or `captureIntegrity.*` flags `false`. |
| 2 | `summary` | Where CPU time went (ratios, top category). | `idleRatio` > 0.95 - the profile is mostly idle. |
| 3 | `findings` | Prioritized hypotheses backed by the capture. | Empty `findings[]` does not prove a healthy profile. |
| 4 | `hotspots` | Where CPU is actually spent (self + inclusive). | A hot leaf in `node_modules` is usually a symptom, not a cause. |
| 5 | `eventLoop` | Latency signal + stall windows. | `confidence = low` or `measurementBasis = histogram` alone. |
| 6 | `gc` | Pause counts, duration, correlated hotspots. | Very short runs with no `gcTimed`. |
| 7 | `hotStacks` | Complete sampled call paths, weighted. | Not always needed - use when a single hotspot is ambiguous. |
| 8 | `deopts` | V8 deoptimisation clusters. | Empty unless `meta.deep === true`. |

---

## 1. `meta` - what was captured

| Field | Meaning |
| --- | --- |
| `durationMs` | Wall-clock duration of the capture. |
| `sampleIntervalMicros` | V8 CPU sampling interval. |
| `command` | The executed command, or `[]` in attach mode. |
| `mode` | `"spawn"` or `"attach"`. |
| `deep` | Whether deopt tracing was enabled. |
| `captureIntegrity` | Quality indicators for timed signals. |

Sanity-check pattern:

- Short `durationMs` → treat ratios and rankings as less stable.
- `captureIntegrity.controlChannel = false` in `spawn` mode → event-loop and GC timing likely degraded.
- In `attach` mode, `controlChannel = false` is **expected** (no FD 3 channel).
- `deep = false` → ignore `deopts[]` entirely.

---

## 2. `summary` - where CPU time went

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

## 3. `findings` - the action queue

Each finding contains:

| Field | Purpose |
| --- | --- |
| `id` | Detector-specific identifier. |
| `severity` | `critical` / `warning` / `info`. |
| `category` | Grouping for filtering. |
| `title` | Short human label. |
| `evidence` | File, line, function, CPU weight, detector-specific `extra`. |
| `why` | Why this pattern matters. |
| `suggestion` | Concrete remediation hint. |
| `references` | Links to docs or related findings. |

Read `findings[]` as **prioritized hypotheses backed by the capture**.

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
| `direct-builtin` | Lanterna directly sampled the builtin/native callee. |
| `attributed-caller` | The builtin was sampled and Lanterna has high-confidence user-caller attribution. |
| `aggregate-correlation` | Based on aggregate timing/correlation rather than a directly sampled callee. |
| `deopt-trace-only` | Comes from `--trace-deopt`, gated by CPU heat. |

</details>

### Detector reference

| Detector id | Interpretation | Typical next step |
| --- | --- | --- |
| `sync-crypto-on-hot-path` | Synchronous crypto on the main thread. | Switch to async crypto or move to worker threads. |
| `blocking-io:<api>` | Synchronous fs / child-process / zlib on the hot path. | Replace with the async equivalent, or move off the request path. |
| `cpu-bound-user-hotspot:<hotspot>` | A user function dominates on-CPU time. | Inspect for algorithmic cost, repeated work, or missing offload. |
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

## 4. `hotspots` - where CPU is actually spent

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

---

## 5. `eventLoop` - latency signal

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

## 6. `gc` - allocation pressure and pauses

| Field | Meaning |
| --- | --- |
| `totalPauseMs` | Cumulative pause time. |
| `count` | Scavenge / mark-sweep counts. |
| `longestPauseMs` | Longest single pause observed. |
| `pausesOver10ms` | Number of pauses exceeding 10 ms. |
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

## 7. `hotStacks` - sampled call paths

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

## 8. `deopts` - V8 JIT instability

Populated only when `meta.deep === true`.

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
> **Reading event-loop lag without reading confidence.** Always read `measurementBasis` and `confidence` alongside the lag numbers.

---

## What to do after reading a report

1. Act on `critical` findings first.
2. Inspect the top 5 hotspots even if they did not trigger a finding.
3. If the run was mostly idle, rerun under representative load.
4. If you suspect JIT instability, rerun with `--deep`.
5. Read the actual source file named in `evidence.file` before making changes.

Want to understand *why* these fields and flags exist? Read [how-lanterna-works.md](how-lanterna-works.md).
