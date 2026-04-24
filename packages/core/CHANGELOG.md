# @lanterna-profiler/core

## 1.1.0

### Minor Changes

- 72a7112: Move profile orchestration into `@lanterna-profiler/core` and narrow `@lanterna-profiler/detectors` to the default CPU detector pack.

  - `@lanterna-profiler/core`: expose `runProfile`, `attachProfile`, `createDefaultKindRegistry`, `createDefaultAnalysisPipeline`, and plugin/pipeline orchestration types; split capture coordinator internals and report schema modules while keeping report schema v2 stable.
  - `@lanterna-profiler/detectors`: remove `runProfile`, `attachProfile`, and `createDefaultKindRegistry` exports; keep built-in detector analyzers, detector adapters, thresholds, and plugin helper types.
  - `@lanterna-profiler/cli`: call profile orchestration from `@lanterna-profiler/core` and use `@lanterna-profiler/detectors` only to register default analyzers.

## 1.0.1

### Patch Changes

- 1da85f7: Improve attach capture lifecycle reliability and progress reporting.

  - `@lanterna-profiler/core`: add a guarded internal capture session so CDP connections are closed and sources are finalized on post-connect failures; expose structured non-fatal capture diagnostics under `meta.captureIntegrity.diagnostics`; add attach runtime-hook, inspector discovery, and PID metadata timeouts with CDP cleanup when targets do not answer; remove temporary spawn preload files on startup failures; clear termination wait timers while rereading real child exit state; and emit `start-capture`, `capture-running`, and `finalize-capture` progress from real capture checkpoints rather than display timing.
  - `@lanterna-profiler/cli`: share run/attach command execution through a common profile-command helper, remove command-level `process.exit(0)`, and handle interactive attach cancellation through `main` with `process.exitCode`.
  - `@lanterna-profiler/detectors`: expose a grouped `extensionApi` surface; forward capture lifecycle progress without delayed duplicate finalization updates; and add extension-contract coverage for duplicate kind, section analyzer, and finding analyzer registrations plus non-fatal analyzer diagnostics.

## 1.0.0

### Major Changes

- a06f9c3: Multi-kind profiling architecture (schema v2). Prepares Lanterna to host memory / async profile kinds alongside CPU without re-refacto.

  **Breaking changes**

  - Report schema bumped to `2.0.0`. CPU sections move from the root into `profiles.cpu.*`:
    - Old: `report.summary`, `report.hotspots`, `report.hotStacks`, `report.gc`, `report.eventLoop`, `report.deopts`
    - New: `report.profiles.cpu.{summary, hotspots, hotStacks, gc, eventLoop, deopts}`
    - `report.meta.profileKinds: string[]` added.
  - Findings carry a required `profileKind: string` tag (all built-in findings are `'cpu'`).
  - Capture API collapsed around a single `runCapture({ source, kinds, ... })` coordinator. Removed: `startSpawnCapture`, `startAttachCapture`, `SourceHandle`, `RawCapture`. New: `CaptureBundle`, `ConnectedSource`, `ProfileSource.connect()`.
  - Runtime preload hook is now composable (`composePreloadScript` + `HookInstaller`); the monolithic `installLanternaRuntimeHook` and the generated `event-loop-hook.cjs` asset are gone.

  **New**

  - `ProfileKind` interface + `ProfileKindRegistry` + `defineProfileKind` in `@lanterna-profiler/core` for plugging additional kinds.
  - Built-in `cpuProfileKind` factory (`createCpuProfileKind`) wiring the CPU probe and analysis contributor.
  - `@lanterna-profiler/core` exposes `createDefaultKindRegistry()` for drivers such as the CLI.
  - CLI gains `--kind <id>` (repeatable or comma-separated), default `cpu`.

## 0.1.1

### Patch Changes

- 6ab5305: Improve profiler reports with schema metadata, correlation scoring, hot-stack clusters, runtime integrity signals, and structured finding measurements/remediation. Detector output is also more focused, with blocking calls grouped by API family and generic CPU-bound findings removed to reduce duplicate or low-actionability results.
