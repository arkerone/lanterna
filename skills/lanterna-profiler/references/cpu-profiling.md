# CPU Profiling Reference

Use this when interpreting the built-in CPU profile kind. The current built-in kind id and report section key are both `cpu`, so CPU analysis lives under `profiles.cpu.*`, CPU meta under `meta.kinds.cpu.*`, and CPU integrity under `meta.captureIntegrity.kinds.cpu.*`.

## Capture Rules

- Ask the user how long to profile before starting a new capture, unless they already provided a duration.
- For servers and APIs, recommend running traffic that represents the workload during the chosen capture window.
- Use `--deep` only with `lanterna run`; it enables deopt tracing and can make stderr noisier.
- Attach mode cannot enable `--deep`; `profiles.cpu.deopts[]` will stay empty.
- Use `--sample-interval <us>` below `1000` only for suspected sub-millisecond hotspots; minimum is `50`.
- If `profiles.cpu.summary.idleRatio > 0.8`, treat the capture as mostly idle and usually rerun with load.
- If `meta.kinds.cpu.samplesTotal` is very low for the requested duration, degrade confidence.

## Report Paths

- `profiles.cpu.summary`: on-CPU ratio, idle ratio, category ratios, top user hotspot.
- `profiles.cpu.hotspots[]`: aggregated frames by `(file, function, line)`.
- `profiles.cpu.hotStacks[]`: frequent full sampled stacks, leaf-to-root.
- `profiles.cpu.hotStackClusters[]`: hot stacks grouped by user-code anchor.
- `profiles.cpu.gc`: pauses, counts, and GC-correlated hotspots.
- `profiles.cpu.eventLoop`: lag metrics, measurement basis, stall intervals, correlated hotspots.
- `profiles.cpu.deopts[]`: V8 deopts when `meta.kinds.cpu.deep === true`.

Ratios such as `onCpuRatio` and `idleRatio` are `0..1`; multiply by 100 before presenting percentages. Hotspot `selfPct` and `totalPct` are already percentages.

## Signal Quality

Before prescribing, check:

- `meta.captureIntegrity.controlChannelExpected && !meta.captureIntegrity.controlChannel`
- `meta.captureIntegrity.eventLoopTimed`
- `meta.captureIntegrity.gcTimed`
- `meta.captureIntegrity.gcObserverAvailable`
- `meta.captureIntegrity.controlChannelWriteErrors`
- `meta.captureIntegrity.gcObserverSetupFailed`
- `meta.captureIntegrity.heartbeatDropped`
- `meta.captureIntegrity.kinds.cpu.samplesTimed`

When the needed signal is degraded, say so explicitly and avoid strong causal language.

## Event Loop

- `eventLoop.available === false`: do not claim measured latency or stalls.
- `measurementBasis === "histogram"`: aggregate-only signal; no temporal stall intervals.
- `measurementBasis === "heartbeats" | "both"`: timed heartbeats are available.
- `confidence === "low" | "none"`: name suspects, but do not assert root cause.
- Treat a specific hotspot as causal only when its correlation `confidence === "high"` and the report has timed stall intervals.

Prefer `eventLoop.correlatedHotspots[]` over generic hotspot guesses. If `correlatedHotspots[].overlapPct` is absent or weak, frame the result as a hypothesis.

## Findings And Priority

Start with `findings[]`, which are already sorted by `priority.score`, severity, and `evidence.selfPct`. Validate the ranking before prescribing:

- Compare `measurements.observed` to `measurements.thresholds`; a large threshold ratio is stronger than severity alone.
- Patch mechanically only when attribution is high-confidence and `remediation` is populated.
- For attributed findings (`blocking-io`, `sync-crypto`, `require-in-hot-path`, `node-modules-hotspot`, `json-on-hot-path`), do not patch the user caller when `evidence.extra.attributionConfidence === "low"`.
- For aggregate findings (`excessive-gc`, `event-loop-stall`, `deopt-loop`), treat `proofLevel === "aggregate-correlation" | "deopt-trace-only"` as a hypothesis unless corroborated by high-confidence candidate hotspots.
- If `categoryTotalPct` is much larger than `calleeTotalPct`, prefer a structural fix for the family of calls over replacing one call site.

Strongest actionable lead:

1. high `priority.score` or observed values well beyond thresholds;
2. `attributionConfidence === "high"` or a direct builtin proof;
3. meaningful event-loop correlation when latency is the concern.

## Interpretation Order

1. State command or PID, duration, samples, top category, and `onCpuRatio * 100`.
2. Summarize actionable findings with evidence location and confidence.
3. List top user-relevant hotspots, even when no detector fired.
4. Summarize GC only when pauses or ratios are materially high.
5. Summarize event-loop impact only when signal quality supports it.
6. Surface deopts only when `meta.kinds.cpu.deep === true`.

If `findings[]` is empty, say that clearly and explain what raw hotspots suggest instead.
