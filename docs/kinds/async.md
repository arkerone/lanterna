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

- **`summary`** — availability, `collectedVia`, operation counts by kind, duration stats, concurrency summary, orphan count, dropped record count, and optional `topAsyncHotFile`.
- **`topOperations`**, **`hotFiles`**, and **`cpuAttribution.topChains`** — ranked async operations, hot user files, and CPU-over-window chains. Entries include `userCaller` when an existing user frame can anchor the work; CPU-window execution frames use `basis: "async-cpu-window"`, otherwise stack-derived anchors use `basis: "async-stack"`.
- **`chains`** — async parent chains rooted at user-code, with depth and frame counts. Drives `deep-async-chain` findings.
- **`topOperations[].awaitFrame` / `primaryReason: "await"`** — await-boundary attribution when available. Drives `long-await` findings.
- **`orphans`** — resources that never resolved or destroyed during capture. Drives `orphan-async-resource` findings.
- **`concurrencyTimeline`** — timeline of inflight and active async work at the configured cadence.
- **`filteredCounts`** — counts of async resources filtered from the public rankings.
- **`cdpAsyncContexts`** — supplemental CDP async stacks, when CDP provided them.
- **`quality`** — `attachPartialCapture`, `cdpAsyncStackCoverageRatio`, `recordsDropped`, CPU attribution coverage, clock-sync uncertainty, `reasons[]`, and `recommendations[]`. Full-instrumentation rewrite counters live under `meta.kinds.async.transformStats`. See [signal-quality.md](../signal-quality.md#profilesasync-quality).

## Findings

| Finding id | Trigger |
| --- | --- |
| `deep-async-chain:<rootAsyncId>` | Async parent chain exceeds the configured depth threshold (often a sign of accidental sequential await). |
| `long-await:<asyncId>` | A specific `await` boundary spent significantly longer than its peers. |
| `orphan-async-resource` | Async resources that initialized during capture but never resolved or destroyed. |
| `microtask-flood` | Microtask volume crosses a per-window threshold (requires `--async-include-microtasks`). |
| `hot-async-context:<rootAsyncId>` | Same async context repeatedly entered — suggests a hot route that should be batched or memoized. |

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
- **User callers are anchors, not proof.** Async `userCaller` is derived from already captured user frames. Prefer high-confidence CPU-window attribution when present; stack-only callers should guide inspection rather than be treated as the definitive line to edit.
