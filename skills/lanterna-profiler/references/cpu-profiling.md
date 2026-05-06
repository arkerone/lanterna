# CPU Profiling Reference

Use this when interpreting the built-in CPU profile kind. The current built-in kind id and report section key are both `cpu`, so CPU analysis lives under `profiles.cpu.*`, CPU meta under `meta.kinds.cpu.*`, and CPU integrity under `meta.captureIntegrity.kinds.cpu.*`.

## Capture Rules

- Ask the user how long to profile before starting a new capture, unless they already provided a duration.
- For servers and APIs, recommend running traffic that represents the workload during the chosen capture window.
- Use `--deep` only with `lanterna run`; it enables deopt tracing and can make target diagnostics noisier.
- Attach mode cannot enable `--deep`; `profiles.cpu.deopts[]` will stay empty.
- Use `--sample-interval <us>` below `1000` only for suspected sub-millisecond hotspots; minimum is `50`.
- Use the report frontmatter as the primary confidence gate. It summarizes CPU quality, low samples, short duration, high idle ratio, untimed samples, and rerun guidance.
- If the frontmatter reports low CPU quality, treat findings as leads, not proof, unless corroborated by source inspection and a stronger rerun.

## Report Paths

These are targeted JSON lookup paths. For analysis, read the agent report first and use its frontmatter, `## Findings` table, `## Finding N` blocks, `Findings.decision` column, `Kind Review`, and `Files To Read First` sections as the contract.

- `profiles.cpu.summary`: on-CPU ratio, idle ratio, category ratios, top user hotspot.
- `profiles.cpu.hotspots[]`: aggregated frames by `(file, function, line)`.
- `profiles.cpu.hotStacks[]`: frequent full sampled stacks, leaf-to-root.
- `profiles.cpu.hotStackClusters[]`: hot stacks grouped by user-code anchor.
- `profiles.cpu.gc`: pauses, counts, and GC-correlated hotspots.
- `profiles.cpu.eventLoop`: lag metrics, measurement basis, stall intervals, correlated hotspots.
- `profiles.cpu.quality`: confidence gate, degraded-signal reasons, rerun recommendations, and millisecond basis.
- `profiles.cpu.deopts[]`: V8 deopts when `meta.kinds.cpu.deep === true`.

Ratios such as `onCpuRatio` and `idleRatio` are `0..1`; multiply by 100 before presenting percentages. Hotspot `selfPct` and `totalPct` are already percentages. Hotspot `selfMs` and `totalMs` use real V8 `timeDeltas` when `profiles.cpu.quality.durationBasis === "timeDeltas"`; otherwise they are interval-based estimates.

## Signal Quality

Before prescribing, check the report frontmatter. If it omits a needed CPU detail, use these targeted JSON paths:

- `profiles.cpu.quality.confidence`
- `profiles.cpu.quality.reasons[]`
- `profiles.cpu.quality.durationBasis`
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

Start with the `## Findings` table, which renders findings in priority order. Validate the ranking before prescribing:

- Prefer `finding.confidence === "high"` and `finding.proofLevel === "direct-sample"` for concrete code changes.
- Treat `proofLevel === "correlated-window"` as strong investigation evidence, not a single-line proof.
- Treat `proofLevel === "trace-only"` and `proofLevel === "heuristic"` as hypotheses until source and/or rerun evidence corroborates them.
- Compare `measurements.observed` to `measurements.thresholds`; a large threshold ratio is stronger than severity alone.
- Patch mechanically only when attribution is high-confidence and `remediation` is populated.
- For attributed findings (`blocking-io`, `sync-crypto`, `require-in-hot-path`, `node-modules-hotspot`, `json-on-hot-path`), do not patch the user caller when `evidence.extra.attributionConfidence === "low"`.
- For legacy reports without top-level `finding.proofLevel`, fall back to `evidence.extra.proofLevel`.
- If `categoryTotalPct` is much larger than `calleeTotalPct`, prefer a structural fix for the family of calls over replacing one call site.

Strongest actionable lead:

1. high `priority.score` or observed values well beyond thresholds;
2. `attributionConfidence === "high"` or a direct builtin proof;
3. meaningful event-loop correlation when latency is the concern.

## Source Positions

Every CPU frame may carry an optional `source` object resolved from a source map: `hotspots[].source`, `summary.topUserHotspot.source`, `hotStacks[].frames[].source`, `hotStacks[].clusters[].anchor.source`, and `findings[].evidence.source`.

- When `source` is present, cite `source.file:source.line` (the original TypeScript / bundled source) — do not cite `file:line` (the compiled `dist/` output).
- When `source` is absent, fall back to `file:line` (no map was found for that frame — common for `node:` builtins or stripped bundles).
- When `function` is `(anonymous)`, prefer `source.name` if set.
- Treat virtual `source.file` values (e.g. `webpack://`, `vite:/`) as bundler labels, not editable files, unless they resolve on disk.
- Gate everything above on `meta.captureIntegrity.sourceMaps.coverage`. Below ~0.7, treat resolved positions as hints, not facts.

## Interpretation Order

1. Read agent frontmatter and frontmatter.
2. Summarize actionable findings from `## Findings` table, `## Finding N` blocks, and `Findings.decision` column.
3. Use `## Kind Review` for top user-relevant hotspots, even when no detector fired.
4. Summarize GC only when pauses or ratios are materially high and supported by the agent report or a targeted JSON lookup.
5. Summarize event-loop impact only when signal quality supports it.
6. Surface deopts only when shown by the report or confirmed via targeted JSON lookup.

If `## Findings` table has no findings, say that clearly and explain what `Kind Review` suggests instead.
