# Async Profiling Reference

Use this for `--kind async` reports. The async kind is experimental and opt-in. It observes async resource lifecycles, run windows, concurrency samples, optional safe API stacks, and CDP async-stack support under `profiles.async.*`, with meta under `meta.kinds.async.*` and integrity under `meta.captureIntegrity.kinds.async.*`.

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

These are targeted JSON lookup paths. For analysis, read the agent report first and use its frontmatter, `## Findings` table, `## Finding N` blocks, `Findings.decision` column, `Kind Review`, and `Files To Read First` sections as the contract.

- `profiles.async.summary`: availability, counts, top kinds, collectedVia, instrumentation mode.
- `profiles.async.quality`: confidence, reasons, recommendations, dropped records, `attachPartialCapture`, CDP stack coverage.
- `profiles.async.records[]`: resource lifecycle records with init, resolve/destroy, run windows, and stacks.
- `profiles.async.chains[]`: parent/trigger chains built from async resource relationships.
- `profiles.async.concurrency`: active/inflight samples over time.
- `profiles.async.awaitGaps[]`: long awaits when enough evidence exists.
- `profiles.async.orphans[]`: resources still unresolved/undestroyed at read time.
- `meta.kinds.async.*`: capture knobs such as instrumentation mode and stack depth.
- `meta.captureIntegrity.kinds.async.*`: per-kind integrity, including dropped records and async-stack support.

## Quality Gate

Before prescribing, check the report frontmatter and async `Kind Review`. If the rendered report omits a needed async detail, use these targeted JSON paths:

- `profiles.async.quality.confidence`
- `profiles.async.quality.reasons[]`
- `profiles.async.quality.attachPartialCapture`
- `profiles.async.quality.recordsDropped`
- `profiles.async.quality.cdpAsyncStackCoverageRatio`
- `profiles.async.summary.collectedVia`
- `profiles.async.summary.instrumentationMode`

Interpretation rules:

- `collectedVia: "async-hooks"` is the strongest async signal.
- `collectedVia: "cdp-only"` means lifecycle records were unavailable; treat async findings as weak or absent.
- `recordsDropped > 0` means high-cardinality workloads exceeded retention; rerun with a shorter window or higher `--async-max-events`.
- `attachPartialCapture: true` means missing preexisting resources is expected, not a target bug.
- CPU attribution through run windows is approximate; prefer wording like "overlapped" unless CPU and async evidence both point to the same source.
- CDP async stacks are supplemental. Low coverage does not invalidate lifecycle records, but it weakens source attribution.

## Findings

Async findings usually include:

- `deep-async-chain`: async parent chains exceed depth thresholds.
- `long-await`: await gaps are materially long.
- `orphan-async-resource`: resources remain unresolved/undestroyed at read time.
- `hot-async-context` / async CPU attribution findings when combined with CPU data.
- `microtask-flood` when microtask or TickObject volume dominates and microtasks were included.

Prefer findings that the `Findings.decision` column marks actionable, with high confidence, clear rendered `Source` / generated fallback, and corroborating records or chains. For orphan resources, inspect whether the resource is intentionally long-lived before patching.

## Source Positions

Await sites, resource origins, and async findings may carry a resolved `source` object. Prefer `source.file:source.line` over the raw `file:line` — raw coordinates point at compiled JS, `source.*` at the original TypeScript or bundled source. Fall back when `source` is missing. Use `source.name` for anonymous frames. Treat virtual paths (`webpack://`, `vite:/`) as bundler labels, not editable files, unless they resolve on disk. Quality gate: `meta.captureIntegrity.sourceMaps.coverage`.

For analysis, use the rendered agent location first. Consult raw async frames only as a targeted JSON lookup when `Kind Review` does not render the specific frame or `userCaller` you need.

## Stop Conditions

Stop and ask for a better capture when:

- async was not requested but the user's question is about awaits, orphan resources, or concurrency;
- `profiles.async.summary.available === false`;
- attach partial capture hides the lifecycle the user cares about;
- dropped records are high enough that top chains or orphans are incomplete;
- the capture is mostly idle or lacks the workload that creates the async behavior.
