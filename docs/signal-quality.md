# Signal Quality

A profile is only as useful as the signals behind it. Lanterna exposes its quality assessment in two layers so consumers can judge how strongly to trust the report:

1. `meta.captureIntegrity.*` — low-level booleans and counters about what was actually observed.
2. `profiles.<kind>.quality` — per-kind, agent-facing confidence with reasons and rerun recommendations.

Always read these **before** drawing conclusions from `findings[]` or hotspot rankings.

## `meta.captureIntegrity`

| Flag | Meaning when `true` | Meaning when `false` |
| --- | --- | --- |
| `controlChannel` | The preload's FD 3 channel delivered events. | No control-channel events. In **attach mode** this is expected (no FD 3); in **spawn mode** it usually means the child closed FD 3 early. |
| `eventLoopTimed` | Heartbeat events were received. | Event-loop measurements come from the histogram only — temporal alignment with hotspots is weaker. |
| `gcTimed` | GC events have timestamps. | GC-hotspot correlation is unavailable. |
| `gcObserverAvailable` | The `PerformanceObserver` GC observer installed correctly. | GC events are missing or empty. |
| `kinds.cpu.samplesTimed` | The CPU profile carried per-sample timing deltas. | `selfMs` / `totalMs` are estimated from the configured sample interval. CPU stack correlation is approximate. |

A fully degraded capture (`controlChannel: false` in spawn mode, `gcTimed: false`, `eventLoopTimed: false`) can still produce useful CPU hotspots, but you lose timed correlation. Some process managers (pm2, certain Docker entrypoints) close extra file descriptors and break FD 3 — try running the process directly when you see this.

For very short processes (< 200 ms), `eventLoopTimed: false` and `gcTimed: false` are normal: the timed observers did not have time to land any samples.

## `profiles.cpu.quality`

Folds the low-level integrity flags and statistical checks into a single user-facing confidence:

| Field | Meaning |
| --- | --- |
| `confidence` | `high`, `medium`, or `low` overall confidence for CPU interpretation. |
| `sampleCount` | Samples used for ratios and hotspots. |
| `durationMs` | Capture duration the scorer used. |
| `idleRatio` | Fraction of samples in idle (mirrors `summary.idleRatio`). |
| `samplesTimed` | Whether V8 supplied per-sample timing deltas. |
| `durationBasis` | `timeDeltas` when hotspot ms come from V8 timings; `sampleInterval` when estimated from the sampling cadence. |
| `reasons[]` | Why confidence was degraded — e.g. low samples, short capture, high idle, untimed samples. |
| `recommendations[]` | Concrete rerun or interpretation guidance. |

Interpretation rules:

- `confidence = high` → rankings and percentages are usually safe to act on after reading source.
- `confidence = medium` → useful for prioritization, avoid over-optimising close calls.
- `confidence = low` → treat findings as leads, not proof. Say what rerun would improve the signal.
- `durationBasis = sampleInterval` → trust `selfPct` / `totalPct` before `selfMs` / `totalMs`.

## `profiles.cpu.eventLoop`

The event-loop section has its own confidence pair so consumers can judge stall correlation independently:

### `measurementBasis`

| Value | Strength |
| --- | --- |
| `both` | Heartbeats **and** histogram — strongest. |
| `heartbeats` | Heartbeats only. |
| `histogram` | Histogram only — no temporal alignment with hotspots. |
| `none` | No usable signal; `eventLoop.available` is `false`. |

### `confidence`

| Value | When |
| --- | --- |
| `high` | Strongest available basis. |
| `low` | Only a weaker basis was available. |
| `none` | No usable signal. |

When `measurementBasis === "histogram"`, `correlatedHotspots[]` is based on overall CPU overlap, not temporal overlap with stall windows — interpret accordingly.

The `event-loop-stall` finding mirrors this distinction in `evidence.extra.proofLevel`. `aggregate-correlation` means a measured stall window had a dominant user hotspot. `hotspot-fallback` means lag crossed the threshold but correlation was not strong enough, so the finding is anchored to the hottest user CPU frame as an inspection lead.

## `profiles.memory.quality`

The memory kind uses the same top-level quality shape as other kinds: `confidence`, `reasons[]`, and `recommendations[]`. Its confidence is derived from the availability and volume of memory-usage samples, heap-sampling data, and heap-snapshot warnings when snapshot analysis is enabled.

Memory-specific signals to inspect alongside `profiles.memory.quality`:

- `summary.rss.slopeBytesPerSec` — linear growth slope. Sustained slopes ≥ 1 MB/s trigger a `memory-growth` finding (warning); ≥ 5 MB/s upgrades to critical. Short captures with warm-up phases can produce artificially steep slopes.
- `memoryUsage.sampleCount` — how many `process.memoryUsage()` samples landed. Below ~10 samples, the slope is unreliable.
- `heapSnapshotAnalysis.available` plus `heapSnapshotAnalysis.warnings[]` — whether retained-growth parsing succeeded. When `available` is `false`, retained-growth claims are absent rather than approximate.

## `profiles.async.*` quality

The async kind reports its own quality fields:

- `quality.attachPartialCapture` — `true` in attach mode, signaling that resources created before hook installation cannot be observed.
- `quality.sampledStackRatio` — fraction of operations whose own init stack contained a user frame.
- `quality.attributedStackRatio` — fraction of operations with a user-editable frame from their own stack **or** inherited via the trigger ancestry. Higher than `sampledStackRatio` because inheritance recovers call sites for operations created deep inside dependencies; drives how often a finding can point at editable code.
- `quality.cdpAsyncStackCoverageRatio` — fraction of resources for which Lanterna obtained a CDP async stack. Low coverage weakens chain-related findings.
- `quality.recordsDropped` — number of records discarded once `--async-max-events` was reached. A non-zero value means the report is sampled, not exhaustive.
- `quality.ambiguousRatio` — fraction of CPU samples that fell in overlapping *unrelated* async run windows (related ancestor/descendant windows are resolved to the innermost context, not counted). CPU-attribution confidence is graded by this ratio rather than collapsing to `low` on the first ambiguous sample.
- `quality.clockSyncUncertaintyMs` — a real measured bound on CPU↔async clock alignment (CDP round-trip jitter / `performance.now()` resolution), not a placeholder. CPU sample times are treated as capture-relative; this bounds the residual `Profiler.start`↔capture-start skew.
- `meta.kinds.async.transformStats.failed` — counter for `--async-instrumentation full` rewrite failures. These are non-fatal; when full instrumentation is partial, `quality.reasons[]` and `quality.recommendations[]` explain how to interpret the report.

## Failure and degradation modes

<details>
<summary><strong>Inspector unavailable</strong></summary>

Lanterna requires inspector support. If the target runtime cannot start the inspector, the run **fails** instead of pretending to profile. Common causes are non-Node targets, security policies that disable `--inspect`, or `NODE_OPTIONS` collisions. See [troubleshooting.md](./troubleshooting.md#inspector-timeout).
</details>

<details>
<summary><strong>Partial preload signal</strong></summary>

If the preload loads but a channel degrades, the report still contains hotspots; event-loop or GC timing may be partial or absent. `captureIntegrity.*` and `profiles.cpu.eventLoop.*` show exactly what was lost.
</details>

<details>
<summary><strong>Low-load captures</strong></summary>

A technically valid profile can still be operationally weak: a high `idleRatio`, short captures, or no representative workload all produce hotspots that may just be startup noise. `profiles.cpu.quality` describes these as degraded confidence with concrete rerun guidance.
</details>

<details>
<summary><strong><code>--deep</code> disabled</strong></summary>

Without `--deep`, deopt tracing is intentionally absent. `profiles.cpu.deopts` is empty and no `deopt-loop:*` finding can be emitted.
</details>

<details>
<summary><strong>Async kind in attach mode</strong></summary>

`--kind async` works in attach mode but capture is partial: resources and code loaded before hook installation are not fully observable. `quality.attachPartialCapture` records this so consumers can downgrade async-kind claims accordingly.
</details>

## See also

- [reading-a-report.md](./reading-a-report.md) — what to do with these signals once you have them.
- [troubleshooting.md](./troubleshooting.md) — symptom-keyed fixes when integrity is low.
- [architecture.md](./architecture.md) — *why* these signals exist and where they come from.
