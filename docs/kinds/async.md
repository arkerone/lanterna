# Async Kind (experimental)

Async resource lifecycle, `await` boundaries, concurrency timeline, and orphan tracking. The async kind is **experimental and opt-in**: the API and findings may evolve, attach mode is partial by design, and `--async-instrumentation full` carries elevated risk.

| Property | Value |
| --- | --- |
| Kind id | `async` |
| Default? | No — opt in with `--kind async`. |
| Stability | Experimental. |
| Report sections | `profiles.async.*` |
| Meta | `meta.kinds.async` |
| Integrity | `meta.captureIntegrity.kinds.async` |

## Capture

```bash
# Default: safe instrumentation
lanterna run --kind async --duration 30s -- node server.js

# Full instrumentation: rewrites later-loaded await sites (higher risk)
lanterna run --kind async --async-instrumentation full --duration 30s -- node server.js

# Combine with CPU/memory if needed
lanterna run --kind cpu,memory,async --duration 30s -- node server.js

# Tighten or loosen the inflight cadence
lanterna run --kind async --async-concurrency-interval 50 -- node server.js
```

Async-specific options:

| Option | Effect |
| --- | --- |
| `--async-max-events <n>` | Cap on retained async resource records. Default `50000`. Once reached, additional records are dropped and `quality.recordsDropped` increments. |
| `--async-stack-depth <n>` | V8 async call-stack depth. Default `32`, max `64`. Higher values capture deeper chains at memory cost. |
| `--async-include-microtasks` | Include `TickObject` / `Microtask` resources. Very noisy — turn on only when the microtask flood detector is your target. |
| `--async-concurrency-interval <ms>` | Cadence for the inflight/active concurrency series. Default `100`. |
| `--async-instrumentation <off\|safe\|full>` | Extra async instrumentation. Default `safe`. `off` disables it entirely. `full` rewrites later-loaded `await` sites — higher risk and only affects code loaded **after** registration. |

## Report sections

`profiles.async.*` exposes:

- **`summary`** — availability, `collectedVia`, operation counts by kind, duration stats, concurrency summary, orphan count, dropped record count, optional `topAsyncHotFile`, and **`byKindLatency`** (per-family `p50/p95/p99/max` of total-lifetime `durationMs` plus `meanWaitMs`, computed over **completed operations only** — orphans are excluded so their capture-clamped, fictional duration cannot skew the percentiles — e.g. compare `http` p99 against `fs` p99).
- **`topOperations`**, **`hotFiles`**, and **`cpuAttribution.topChains`** — ranked async operations, hot user files, and CPU-over-window chains. Entries include `userCaller` when an existing user frame can anchor the work; CPU-window execution frames use `basis: "async-cpu-window"`, otherwise stack-derived anchors use `basis: "async-stack"`.
- **`topOperations[]` latency decomposition** — each operation carries `durationMs` (total lifetime), `runMs` (time on CPU), **`waitMs`** (time alive but *not* on CPU — the real latency), **`scheduleDelayMs`** (init → first run, i.e. queue/scheduling delay), and **`firstRunAtMs`**. The classified **`latencyCause`** (`event-loop-blocked` | `gc-pause` | `downstream-async` | `io-wait` | `cpu-bound` | `background` | `unknown`) plus `causeConfidence` and `causeEvidence` explain *why* the operation was slow, and **`attributedFrameOrigin`** records where the anchored user frame came from (`self`, `inherited-trigger`, `cpu-window`, or `cdp`). `background` marks a long-lived resource that is not a latency bug: either idle (never ran, alive ~the whole capture) or a **persistent/multiplexed** handle (keep-alive socket, HTTP parser, pool, interval) that activated many times across most of the capture — its aggregate `waitMs` is the idle gap between activations, not a single delayed callback. When `latencyCause` is `unknown`, `causeEvidence.basis` is `no-eventloop-signal` if the event-loop heartbeat was unavailable (the loop could not be checked) versus `none` if it simply did not overlap any signal. Orphans (resources still in flight at capture end) are **excluded** from `topOperations` and listed in `orphans[]` instead, so their fictional capture-clamped duration does not dominate the ranking.
- **`chains`** — async parent chains rooted at user-code, with depth and frame counts. Drives `deep-async-chain` findings.
- **`topOperations[].awaitFrame` / `primaryReason: "await"`** — await-boundary attribution when available. Drives `long-await` findings.
- **`orphans`** — resources that never resolved or destroyed during capture. Drives `orphan-async-resource` findings.
- **`concurrencyTimeline`** — timeline of inflight and active async work at the configured cadence.
- **`filteredCounts`** — counts of async resources filtered from the public rankings.
- **`cdpAsyncContexts`** — supplemental CDP async stacks, when CDP provided them.
- **`quality`** — `attachPartialCapture`, `sampledStackRatio`, **`attributedStackRatio`** (fraction of operations with a user-editable frame, from their own stack or inherited via the trigger ancestry), `cdpAsyncStackCoverageRatio`, `recordsDropped`, CPU attribution coverage, **`ambiguousRatio`** (CPU samples that fell in overlapping *unrelated* run windows), a real measured `clockSyncUncertaintyMs`, `reasons[]`, and `recommendations[]`. Full-instrumentation rewrite counters live under `meta.kinds.async.transformStats`. See [signal-quality.md](../signal-quality.md#profilesasync-quality).

## Findings

| Finding id | Trigger |
| --- | --- |
| `deep-async-chain:<rootAsyncId>` | Async parent chain exceeds the configured depth threshold (often a sign of accidental sequential await). |
| `long-await:<asyncId>` | A specific `await` boundary spent significantly longer than its peers. |
| `orphan-async-resource` | Async resources that initialized during capture but never resolved or destroyed. |
| `microtask-flood` | Microtask volume crosses a per-window threshold (requires `--async-include-microtasks`). |
| `hot-async-context:<rootAsyncId>` | Same async context repeatedly entered — suggests a hot route that should be batched or memoized. |
| `event-loop-blocked-async:<asyncId>` | A slow async operation whose `waitMs` overlaps an event-loop stall — the latency is a blocked loop, not slow I/O. Anchored on the synchronous CPU frame that blocked the loop (needs `--kind cpu,async`). |

## Reading order

1. `quality.attachPartialCapture` and `quality.recordsDropped` — was capture complete enough?
2. `findings[]` filtered to `profileKind === "async"` — prioritized async issues.
3. `summary` totals — did the run see a representative volume of async work?
4. `concurrencyTimeline` — does inflight work pile up over time (queue growth) or stay flat?
5. `topOperations` and `chains` — drill into the slowest operations, await frames, and deepest chains.
6. `orphans` — anything that started and never finished.

## Caveats

- **Attach mode is partial.** Resources created **before** Lanterna installs hooks are not observable, and `--async-instrumentation full` cannot rewrite already-loaded code. `quality.attachPartialCapture` records this and the async findings should be downgraded accordingly.
- **`--async-instrumentation full` is experimental.** It rewrites `await` sites in modules loaded **after** registration. Code loaded earlier is not covered. It can interact poorly with bundlers, source maps, or other instrumentation hooks. Stick to `safe` unless `safe` cannot identify the await sites you need.
- **Microtasks default to off.** Enabling `--async-include-microtasks` produces very noisy reports. Use it only for the `microtask-flood` finding.
- **Dropped records are sampled, not lost forever.** `quality.recordsDropped > 0` means raise `--async-max-events` for the next run if completeness matters.
- **User callers are anchors, not proof.** Async `userCaller` is derived from already captured user frames. Prefer high-confidence CPU-window attribution when present; stack-only callers should guide inspection rather than be treated as the definitive line to edit. When an operation's own stack has no user frame, the frame may be inherited from the trigger ancestry — `attributedFrameOrigin: "inherited-trigger"` flags this (lower confidence than `self`).
- **Latency cause is a windowed correlation.** `latencyCause` is derived by overlapping an operation's wait windows with event-loop stalls, GC pauses, and downstream-async activity (or by I/O kind / CPU ratio). It is a directional explanation with `causeConfidence` + `causeEvidence`, not proof of causation — treat `unknown` as "not enough signal", not "no problem". Per-cause limits worth knowing:
  - **`event-loop-blocked`** requires the loop to have still been stalled when the callback became *runnable* (around `firstRunAtMs`). A stall that ended well before the operation ran is treated as a coincidental overlap, not the cause — so a genuinely slow I/O whose wait merely *spans* an unrelated stall is not mislabelled.
  - **`gc-pause`** is matched against the *actual* GC pause durations (not padded windows), so it only fires when GC genuinely dominates a wait — which is rare, because most GC pauses are sub-millisecond. Expect `gc-pause` to be uncommon; its absence is not evidence that GC is cheap.
  - **`downstream-async`** only fires when a **trigger-descendant runs on CPU** during the parent's wait. Work you `await` that is itself *waiting* (e.g. a timer or socket resolved on a sibling resource, not a trigger-descendant) is **not** counted and typically shows as `unknown`. Do not read the absence of `downstream-async` as "nothing downstream".
  - **One `await` fragments into several promise resources** (the async function's result promise, the awaited promise, intermediate reactions). Only the resource that actually carries the work is classified — the one running CPU shows as `cpu-bound`, while its sibling/parent promises that merely wait on it commonly show as `unknown`. Read `topOperations` at the level of the resource that carries `runMs`/`waitMs`, not the count of `unknown` siblings.
- **The blocking frame is attributed per stall.** The `event-loop-blocked-async` finding anchors on the user frame that dominated CPU during the *specific* stall that delayed each operation — matched by when the callback became runnable (`firstRunAtMs`) — so several distinct blocking call sites each point at their own culprit rather than one globally-dominant frame (`profiles.cpu.eventLoop.stallIntervals[].topFrame` carries the per-stall culprit). It falls back to the globally-dominant hotspot only when an op's run time matches no stall, and stands down entirely when no CPU hotspot correlates.
- **CPU↔async attribution is statistical, with a reported bound.** CPU sample times are profile-relative (≈ capture-relative); the residual skew versus the async timeline is the small `Profiler.start`↔capture-start startup gap, surfaced as `quality.clockSyncUncertaintyMs` (a real measured bound — CDP round-trip jitter / `performance.now()` resolution, replacing the former misleading value). The precision win is in attribution, not the clock: samples in overlapping ancestor/descendant run windows are attributed to the innermost async context, and only genuinely *unrelated* overlapping windows count toward `quality.ambiguousRatio`, which lowers CPU-attribution confidence proportionally instead of dropping the sample.
- **Public async file paths are normalized.** When V8/CDP reports `file://` URLs, Lanterna converts them to normal filesystem paths before grouping hot files, chains, and finding evidence. Virtual bundler URLs are kept as-is.
