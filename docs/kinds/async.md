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
| `--async-max-events <n>` | Cap on retained async resource records. Default `50000`. Once reached, additional events are dropped and `quality.droppedEvents` increments. |
| `--async-stack-depth <n>` | V8 async call-stack depth. Default `32`, max `64`. Higher values capture deeper chains at memory cost. |
| `--async-include-microtasks` | Include `TickObject` / `Microtask` resources. Very noisy — turn on only when the microtask flood detector is your target. |
| `--async-concurrency-interval <ms>` | Cadence for the inflight/active concurrency series. Default `100`. |
| `--async-instrumentation <off\|safe\|full>` | Extra async instrumentation. Default `safe`. `off` disables it entirely. `full` rewrites later-loaded `await` sites — higher risk and only affects code loaded **after** registration. |

## Report sections

`profiles.async.*` exposes:

- **`summary`** — total resources, totals per type, destruction rate.
- **`chains`** — async parent chains rooted at user-code, with depth and frame counts. Drives `deep-async-chain` findings.
- **`awaits`** — `await` boundaries with elapsed-time distribution. Drives `long-await` findings.
- **`orphans`** — resources that never resolved or destroyed during capture. Drives `orphan-async-resource` findings.
- **`concurrency`** — timeline of inflight and active async work at the configured cadence.
- **`microtasks`** — microtask volume (only when `--async-include-microtasks`).
- **`hotContexts`** — async contexts repeatedly reentered, useful for spotting hot routes.
- **`quality`** — `attachPartialCapture`, `cdpStackCoverage`, `droppedEvents`, `instrumentationFailures`. See [signal-quality.md](../signal-quality.md#profilesasync-quality).

## Findings

| Finding id | Trigger |
| --- | --- |
| `deep-async-chain:<rootAsyncId>` | Async parent chain exceeds the configured depth threshold (often a sign of accidental sequential await). |
| `long-await:<asyncId>` | A specific `await` boundary spent significantly longer than its peers. |
| `orphan-async-resource` | Async resources that initialized during capture but never resolved or destroyed. |
| `microtask-flood` | Microtask volume crosses a per-window threshold (requires `--async-include-microtasks`). |
| `hot-async-context:<rootAsyncId>` | Same async context repeatedly entered — suggests a hot route that should be batched or memoized. |

## Reading order

1. `quality.attachPartialCapture` and `quality.droppedEvents` — was capture complete enough?
2. `findings[]` filtered to `profileKind === "async"` — prioritized async issues.
3. `summary` totals — did the run see a representative volume of async work?
4. `concurrency` — does inflight work pile up over time (queue growth) or stay flat?
5. `awaits` and `chains` — drill into the slowest awaits and deepest chains.
6. `orphans` — anything that started and never finished.

## Caveats

- **Attach mode is partial.** Resources created **before** Lanterna installs hooks are not observable, and `--async-instrumentation full` cannot rewrite already-loaded code. `quality.attachPartialCapture` records this and the async findings should be downgraded accordingly.
- **`--async-instrumentation full` is experimental.** It rewrites `await` sites in modules loaded **after** registration. Code loaded earlier is not covered. It can interact poorly with bundlers, source maps, or other instrumentation hooks. Stick to `safe` unless `safe` cannot identify the await sites you need.
- **Microtasks default to off.** Enabling `--async-include-microtasks` produces very noisy reports. Use it only for the `microtask-flood` finding.
- **Dropped events are sampled, not lost forever.** `quality.droppedEvents > 0` means raise `--async-max-events` for the next run if completeness matters.
