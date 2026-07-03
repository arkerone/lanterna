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

### `meta.captureIntegrity` drop counters

The always-on in-target buffers (event-loop heartbeats, GC events, `process.memoryUsage()` samples) are capped so an abandoned or very long capture can't grow the target's heap unboundedly. Hitting a cap evicts the oldest entries — these counters record when that happened:

| Counter | `heartbeatDropped` vs. `eventLoopSamplesDropped` |
| --- | --- |
| `heartbeatDropped` | Heartbeat events lost to a **failed control-channel write** (e.g. a broken pipe), spawn mode only. Not a buffer-cap eviction. |
| `eventLoopSamplesDropped` | Heartbeat samples evicted from the in-target buffer once its cap was reached (drop-oldest). Relevant mainly for very long attach/in-process captures. |
| `gcEventsDropped` | GC events evicted from the in-target buffer once its cap was reached (drop-oldest). |
| `memoryUsageSamplesDropped` | `process.memoryUsage()` samples evicted from the in-target buffer once its cap was reached (drop-oldest). |

All four default to `0` and stay there in normal use. In **spawn mode** every event also streams live over the control channel as it happens, so these caps are essentially unreachable. In **attach/in-process mode**, the coordinator's periodic mid-capture drain (see "Periodic mid-capture drain" below) reads and empties these buffers every few seconds during the capture, which is what keeps the caps unreachable there too — a non-zero value means the drain itself couldn't keep up (see `captureIntegrity.diagnostics` for a `runtime-read` entry explaining why) or draining wasn't running (very old Lanterna version, or the drain hadn't started yet during a very short capture).

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

## Caveat → action cheat-sheet

When an agent or automation sees one of these flags, this is the one-line "so what". Each row is expanded in the sections above and below.

| Signal seen | What it means | Next action |
| --- | --- | --- |
| `meta.durationMs` very short (< 200 ms) | Timed observers never landed; correlation is weak. | Rerun longer with representative load (`--duration`, `--workload`). |
| `captureIntegrity.controlChannel = false` (spawn) | FD 3 closed early (pm2, Docker entrypoint, descriptor stripping). | Run the target directly; weight GC/event-loop timing less. |
| `captureIntegrity.controlChannel = false` (attach) | Expected — attach has no FD 3. | No action; this is normal in attach mode. |
| `captureIntegrity.gcTimed = false` | GC-hotspot correlation unavailable. | Don't claim GC causality; rerun longer if GC matters. |
| `kinds.cpu.samplesTimed = false` | `selfMs`/`totalMs` estimated from interval. | Trust `selfPct`/`totalPct` over millisecond fields. |
| `profiles.cpu.quality.confidence = low` | Profile too short/idle/under-sampled. | Treat findings as leads; follow `recommendations[]`. |
| `profiles.cpu.summary.idleRatio > 0.8` | Mostly idle — likely no real load. | Rerun under `--workload`; current hotspots may be startup noise. |
| `profiles.cpu.eventLoop.measurementBasis = histogram` | No temporal alignment with stalls. | Don't claim stall causality from `correlatedHotspots[]`. |
| `profiles.cpu.deopts` empty | `--deep` was off; deopt tracing absent. | Rerun with `--deep` if you suspect JIT instability (spawn only). |
| `profiles.memory` slope steep on short capture | Warm-up inflates the slope. | Rerun longer / after warm-up before calling it a leak. |
| `profiles.memory.heapSnapshotAnalysis.available = false` | Snapshot too large or parse failed. | Retained-growth claims are absent, not approximate; see warnings. |
| `profiles.async.quality.attachPartialCapture = true` | Pre-install resources/code invisible. | Downgrade async findings; prefer spawn for async completeness. |
| `profiles.async.quality.recordsDropped > 0` | Report is sampled, not exhaustive. | Raise `--async-max-events` next run if completeness matters. |
| `profiles.async.quality.cdpAsyncStackCoverageRatio < 0.2` | Async stacks largely unavailable (older Node). | Weaken chain findings; `--kind cpu,async` improves attribution. |
| `meta.kinds.async.transformStats.failed > 0` | Some `full` rewrites failed (non-fatal). | Read `quality.reasons[]`; prefer `safe` if failures are high. |
| `captureIntegrity.eventLoopSamplesDropped > 0` / `gcEventsDropped > 0` / `memoryUsageSamplesDropped > 0` | An in-target buffer overflowed before it could be read (rare — spawn streams live, and attach/in-process drain periodically). | Check `captureIntegrity.diagnostics` for a `runtime-read` entry; if the target was unusually busy, expect some early history to be trimmed. |
| `meta.targetCrash` present | The target hit a fatal uncaught exception during the capture (spawn only). | Read `targetCrash.message`; the capture up to that point is still valid, but nothing after the crash was observed. |
| `profiles.async.quality.pendingAwaitStacksDropped > 0` / `runWindowsDropped > 0` / `concurrencySamplesDropped > 0` | Finer-grained async truncation under sustained high load. | Treat the affected attribution/timeline slices as sampled, not exhaustive; see `quality.reasons[]`. |
| `findings[]` empty | Heuristics found nothing — **not** proof of health. | Still inspect top 5 hotspots/allocators manually. |

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

<details>
<summary><strong>Periodic mid-capture drain (attach/in-process)</strong></summary>

Spawn mode streams every event-loop heartbeat, GC event, and async-hooks record live over the FD 3 control channel as it happens. Attach and in-process mode have no such channel — historically the in-target buffers were read exactly once, at stop, so a target that exited or hung mid-capture lost everything since the start.

The coordinator now drains those buffers periodically (every ~10s) while an attach/in-process capture runs, in addition to the final read at stop. Each drain pulls and empties the event-loop and GC buffers, and — for the async kind — the async_hooks records that have already *completed* (in-flight resources are left alone so later lifecycle callbacks keep finding them). This bounds the worst-case loss to roughly one drain interval instead of the whole capture, and keeps the in-target buffer caps (see `captureIntegrity.eventLoopSamplesDropped`/`gcEventsDropped`) practically unreachable even on long captures. It has no effect in spawn mode, and no user-visible configuration — if a drain read times out, it shows up as a `runtime-read` entry in `captureIntegrity.diagnostics`, recorded once (not once per tick) so a persistently busy target doesn't spam the diagnostics list.
</details>

## See also

- [reading-a-report.md](./reading-a-report.md) — what to do with these signals once you have them.
- [troubleshooting.md](./troubleshooting.md) — symptom-keyed fixes when integrity is low.
- [architecture.md](./architecture.md) — *why* these signals exist and where they come from.
