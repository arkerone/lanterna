# CONTEXT.md — domain glossary

This file is the shared vocabulary for Lanterna. `CLAUDE.md` says *how to work in
the repo*; `docs/architecture.md` is the long-form design; this file is the short,
stable dictionary of the nouns those documents use. When a term here and the code
disagree, the code wins — fix this file.

Lanterna is an **agent-first** Node.js CPU/memory/async profiler. The product is a
structured, categorized `LanternaReport` (JSON) meant to be consumed by an agent or
automated pipeline, not a flamegraph for a human.

## The two-phase pipeline

Everything is organized around **Capture → Enrichment**.

- **Capture** — collect raw runtime data. No analysis happens here. Produces a
  `CaptureBundle`.
- **Enrichment** — turn the `CaptureBundle` into a `LanternaReport`: build per-kind
  sections, run detectors to emit findings, let each kind finalize its section.

Spawn and attach modes **share the entire enrichment pipeline**; only capture
collection differs. The report schema is identical between them.

## Core nouns

- **`ProfileSource`** — supplies a live CDP connection to the coordinator.
  `SpawnSource` launches the target under `--inspect-brk` with a `--require` preload
  and an FD-3 control channel; `AttachSource` connects to an already-running
  inspector and evaluates the same hooks in-process over CDP.
- **`runCapture`** — the capture coordinator. Runs each active kind's probe plus the
  always-on runtime-signals installer (event-loop heartbeat/histogram + GC observer).
- **`CaptureBundle`** — raw capture output: `{ target, runtimeSignals, kinds,
  captureIntegrity, … }`. Has no findings and no analysis.
- **`AnalysisPipeline`** — consumes a `CaptureBundle` and produces a report. Each kind
  contributes its `profiles.<sectionKey>` section; detectors emit `findings[]`; each
  kind's `finalize` hook then patches its own section using the final findings.
- **`buildLanternaReport`** — assembles the final `LanternaReport`.
- **`LanternaReport`** — the product. `{ meta, profiles, findings, extensions? }`.
  Schema is versioned (`LANTERNA_REPORT_SCHEMA_VERSION`, currently v2).

## Profile kinds — the primary extensibility seam

- **`ProfileKind`** — the unit you add to measure a new axis (built via
  `defineProfileKind`). Built-ins: `cpu` (default), `memory`, `async` (experimental,
  opt-in). A kind bundles a probe, an analysis contributor, a Zod `reportSchema`,
  meta/integrity contributions, an optional preload `hookInstaller`, and an optional
  `finalize` hook.
- **`CaptureProbe`** — a kind's `install/start/stop/dispose` lifecycle, driven over CDP.
- **Module augmentation** — a kind declares its types by augmenting three interfaces in
  `kinds/core/types.ts`: `CaptureKindDataMap` (raw probe output),
  `ProfileSectionMap` (the `report.profiles[kind]` shape), and `KindViews` (what
  `context.forKind(kind)` returns). Augment all three.
- **`reportSectionKey`** — where a kind writes in `report.profiles`. Usually equals the
  CLI kind id, but may differ for custom kinds.

## Detectors and findings

- **Detector** — a kind-scoped finding analyzer (`KindScopedDetector<K>`) declaring the
  `kindIds` it needs. The wrapper auto-skips a detector if any declared kind is absent
  from the capture, so cross-kind detectors (e.g. `alloc-in-hot-path` needs
  `cpu`+`memory`) gracefully no-op instead of erroring.
- **`Finding`** — one categorized result. Sorted by `priority.score`, auto-tagged with
  `profileKind`. Carries three independent axes:
  - **`severity`** — impact if real.
  - **`confidence`** (`high|medium|low`) — strength of evidence.
  - **`proofLevel`** (`direct-sample|correlated-window|trace-only|heuristic`) — kind of
    evidence. Severity ≠ confidence ≠ proofLevel; keep them distinct.
- **`DETECTOR_THRESHOLDS`** — centralized built-in thresholds (`detectors/src/config.ts`).
- **Best-effort detector** — a detector whose example verification only *warns* when its
  finding is absent (probabilistic: depends on V8 trace timing or async/CPU
  correlation). Today: `deopt-loop`, `deep-async-chain`, `hot-async-context`.

## Quality and integrity

- **`captureIntegrity`** — what was *actually* observed during capture (e.g. control
  channel present, heartbeat/GC counts). Records partial signals honestly; it does not
  mean the run failed.
- **`profiles.<kind>.quality`** — per-kind quality flags, ratios, `reasons[]`, and
  `recommendations[]` (e.g. async `attachPartialCapture`, `recordsDropped`,
  `cdpAsyncStackCoverageRatio`). Consumers downgrade confidence based on these.
- **Fail-fast philosophy** — if the V8 inspector can't be reached, the run *fails*.
  Lanterna never silently falls back to a weaker mode. Partial *signals* are fine and
  expected; silent degradation of *mode* is not.

## Other terms

- **Noise / self-noise** — frames, packages, and retainer paths belonging to Lanterna's
  own injected code. Classified through a registry (`registerNoiseFilter`), not ad-hoc
  patterns inside analyzers.
- **`mode`** — `spawn`, `attach`, or the reserved `in-process` (no current producer).
- **Two Node floors** — Lanterna itself needs Node `>=22`; the *profiled target* only
  needs `>=12`.

## Dependency direction (strict)

`cli → core`, `cli → detectors`, `detectors → core`. **`core` never imports
`detectors`.** Detectors are just `FindingAnalyzer`s plugged into core's pipeline. If
core seems to need a detector, the seam is wrong.
