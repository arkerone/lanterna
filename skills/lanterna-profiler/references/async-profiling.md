# Async Profiling Reference

Use this for `--kind async` reports. This reference supports an interactive investigation — read the agent report first, then return here to interpret async lifecycle records, distinguish CPU work from awaits, and judge whether attach-mode partial capture is hiding the resources the user cares about.

The async kind is experimental and opt-in. It observes async resource lifecycles, run windows, concurrency samples, optional safe API stacks, and CDP async-stack support under `profiles.async.*`, with meta under `meta.kinds.async.*` and integrity under `meta.captureIntegrity.kinds.async.*`.

## When to Capture Async

Use async capture for:

- long `await` gaps, deep async chains, or unclear promise parentage;
- orphan resources such as timers, sockets, requests, or promises that never resolve/destroy during the window;
- concurrency questions: too much inflight work, bursty fan-out, or handler overlap;
- latency investigations where CPU samples alone do not explain where time is spent.

Do not use async capture for generic "code is slow" work. Start with CPU. Combine `--kind cpu --kind async` only when you need both CPU attribution and async-chain timing, because async hooks add non-trivial overhead on async-heavy workloads.

## Modes And Overhead

- `--async-instrumentation off`: async_hooks lifecycle data only. Lowest overhead, weakest source attribution.
- `--async-instrumentation safe` (default): additionally patches Promise handlers, timers, fetch, fs callbacks, and http/https request callbacks to capture safer registration/handler stacks.
- `--async-instrumentation full`: experimental AST-based `await` instrumentation for code loaded after registration. Higher risk and overhead; use only when safe mode cannot explain await sites.

Lanterna prints a warning for `--kind async`, and a stronger warning for `--async-instrumentation=full`.

## Run Vs Attach

`lanterna run --kind async ...` installs hooks before user code starts, so it can observe resources created during startup and the capture window.

`lanterna attach --kind async ...` injects hooks into an already-running process. It is partial by design:

- resources created before hook installation are not observable;
- already-loaded CommonJS/ESM code cannot be rewritten by `full` instrumentation;
- quality may include `attachPartialCapture: true`.

Attach reports can still be useful for new resources created during the capture window, concurrency shape, and CDP async stacks.

## Report Paths

These are targeted JSON lookup paths. For analysis, read the agent report first and use its frontmatter, `## Findings` table, `## Finding N` blocks, the `decision` column, `Kind Review`, and `Files To Read First` sections as the contract.

- `profiles.async.summary`: availability, counts, top kinds, `collectedVia`, dropped record count, optional `topAsyncHotFile`, and `byKindLatency` (per-family `p50/p95/p99/max` of lifetime + `meanWaitMs`, completed ops only).
- `profiles.async.quality`: confidence, reasons, recommendations, dropped records, `attachPartialCapture`, CDP stack coverage.
- `profiles.async.topOperations[]`: ranked **completed** resource lifecycle summaries — `durationMs`/`runMs`/`waitMs`/`scheduleDelayMs`, frames, optional await/CPU attribution, and a classified `latencyCause` (+ `causeConfidence`/`causeEvidence`/`attributedFrameOrigin`). Orphans are excluded (see `orphans[]`).
- `profiles.async.hotFiles[]`: ranked user files responsible for async work.
- `profiles.async.chains[]`: parent/trigger chains built from async resource relationships.
- `profiles.async.concurrencyTimeline[]`: active/inflight samples over time.
- `profiles.async.orphans[]`: resources still unresolved/undestroyed at capture end — excluded from `topOperations`/`byKindLatency` because their capture-clamped duration is fictional.
- `profiles.async.cdpAsyncContexts[]`: supplemental CDP async stacks.
- `profiles.async.cpuAttribution.topChains[]`: CPU attributed to async run windows when CPU was captured.
- `meta.kinds.async.*`: capture knobs such as instrumentation mode and stack depth.
- `meta.captureIntegrity.kinds.async.*`: per-kind integrity, including dropped records and async-stack support.

## Quality Gate

Before prescribing, check the report frontmatter and async `Kind Review`. If the rendered report omits a needed async detail, use these targeted JSON paths:

- `profiles.async.quality.confidence`
- `profiles.async.quality.reasons[]`
- `profiles.async.quality.attachPartialCapture`
- `profiles.async.quality.recordsDropped`
- `profiles.async.quality.cdpAsyncStackCoverageRatio`
- `profiles.async.quality.instrumentationMode`
- `profiles.async.summary.collectedVia`
- `profiles.async.summary.recordsDropped`

Interpretation rules:

- `collectedVia: "async-hooks"` is the strongest async signal.
- `collectedVia: "cdp-only"` means lifecycle records were unavailable; treat async findings as weak or absent.
- `recordsDropped > 0` means high-cardinality workloads exceeded retention; rerun with a shorter window or higher `--async-max-events`.
- `attachPartialCapture: true` means missing preexisting resources is expected, not a target bug.
- CPU attribution through run windows is approximate; prefer wording like "overlapped" unless CPU and async evidence both point to the same source.
- CDP async stacks are supplemental. Low coverage does not invalidate lifecycle records, but it weakens source attribution.

## Latency Decomposition And Cause

With `--kind cpu,async`, each `topOperations[]` entry splits its lifetime into `runMs` (on CPU), `waitMs` (alive but not on CPU — the real latency), and `scheduleDelayMs` (init → first run), and carries a classified `latencyCause` with `causeConfidence` + `causeEvidence`. `latencyCause` is a windowed correlation (wait vs event-loop stalls, GC pauses, descendant CPU), not proof. Read each value with its real reliability:

- `event-loop-blocked` — high-value and reliable. The callback was ready but the loop was still stalled when it became runnable. Pair with the `event-loop-blocked-async` finding, which names the synchronous CPU frame to fix — **not** the await site. Trust it over the (innocent) async call site.
- `cpu-bound` — reliable. A single `await` fragments into several promise resources; only the work-carrying one is `cpu-bound` (`runMs ≈ durationMs`), while its sibling/parent promises commonly read `unknown`. Anchor on the resource that carries `runMs`/`waitMs`, not the count of `unknown` siblings.
- `io-wait` — a *residual* for I/O-kind resources with no other explanation, not positive proof of remote slowness. Corroborate with the dependency/remote before concluding.
- `gc-pause` — **rare by design**: GC pauses are matched against their real (sub-millisecond) durations, so they seldom dominate ≥50% of a wait. Its absence is not evidence GC is cheap — confirm GC pressure with `--kind memory`.
- `downstream-async` — only when a *trigger-descendant runs on CPU* during the wait. Work you `await` that is itself waiting (a timer/socket resolved on a sibling resource) is **not** caught and shows as `unknown`; do not read its absence as "nothing downstream".
- `background` — a long-lived handle that is not a latency bug: idle (never ran) or a persistent/multiplexed handle (keep-alive socket, HTTP parser, pool, interval) that activated many times across most of the capture. Its `waitMs` aggregates idle gaps between activations, so these are deliberately excluded from `event-loop-blocked-async` and `long-await` — a keep-alive connection spanning the capture is not a single multi-second blocked callback.
- `unknown` — `causeEvidence.basis: "no-eventloop-signal"` means the heartbeat was unavailable (capture in run mode to classify); `"none"` means a real wait that matched no signal. Treat as "not enough signal", not "no problem".

`summary.byKindLatency` gives per-family `p50/p95/p99/max` of lifetime + `meanWaitMs` over completed ops only. The `event-loop-blocked-async` finding anchors on the user frame that dominated CPU during the *specific* stall that delayed each op (matched by `firstRunAtMs`; per-stall culprits are in `profiles.cpu.eventLoop.stallIntervals[].topFrame`), so distinct blockers each point at their own frame; it falls back to the globally-dominant hotspot only when an op matches no stall, and stands down when no hotspot correlates.

## Findings

Async findings usually include:

- `deep-async-chain`: async parent chains exceed depth thresholds.
- `long-await`: async operations or await frames are materially long; carries the latency decomposition and cause-specific guidance.
- `orphan-async-resource`: resources remain unresolved/undestroyed at read time.
- `event-loop-blocked-async`: an async operation's wait overlaps an event-loop stall — latency is a blocked loop, not slow I/O — anchored on the synchronous CPU frame to fix (needs `--kind cpu,async`).
- `hot-async-context` / async CPU attribution findings when combined with CPU data.
- `microtask-flood` when microtask or TickObject volume dominates and microtasks were included.

Prefer findings that the `decision` column marks actionable, with high confidence, clear rendered `location` / fallback, and corroborating top operations or chains. For orphan resources, inspect whether the resource is intentionally long-lived before patching.

## Source Positions

Await sites, resource origins, and async findings may carry a resolved `source` object. Prefer `source.file:source.line` over the raw `file:line` — raw coordinates point at compiled JS, `source.*` at the original TypeScript or bundled source. Fall back when `source` is missing. Use `source.name` for anonymous frames. Treat virtual paths (`webpack://`, `vite:/`) as bundler labels, not editable files, unless they resolve on disk. Quality gate: `meta.captureIntegrity.sourceMaps`; when `applicable !== false` and `coverage` is low, treat mapped positions as hints. `applicable: false` means plain JS without source maps, not degraded mapping.

When V8/CDP supplies `file://` URLs for async frames, Lanterna normalizes public report paths to normal filesystem paths before grouping hot files, chains, and finding evidence. Virtual bundler URLs remain virtual.

For analysis, use the rendered agent location first. Consult raw async frames only as a targeted JSON lookup when `Kind Review` does not render the specific frame or `userCaller` you need.

In `## Files To Read First`, async rows use specific reasons such as `top async hot file`, `long async operation`, `long async operation caller`, `async hot file`, and `async CPU attribution`. Prefer `read-first` user callers for external async work; treat `inspect-lead` rows as places to confirm the async chain before editing. Pseudo/runtime async frames are filtered out of Kind Review tables unless an editable user caller can anchor the operation.

## Stop Conditions

Stop and ask for a better capture when:

- async was not requested but the user's question is about awaits, orphan resources, or concurrency;
- `profiles.async.summary.available === false`;
- attach partial capture hides the lifecycle the user cares about;
- dropped records are high enough that top chains or orphans are incomplete;
- the capture is mostly idle or lacks the workload that creates the async behavior.
