# @lanterna-profiler/detectors

## 1.3.0

### Minor Changes

- d694c2f: ## Add `memory` profile kind

  Adds a new `memory` profile kind alongside the existing `cpu` kind.

  - Drives the V8 sampling heap profiler (`HeapProfiler.startSampling` /
    `stopSampling`) and emits a `profiles.memory.{summary,hotAllocators,memoryUsage}`
    section in the Lanterna report.
  - Samples `process.memoryUsage()` at a fixed cadence via a preload hook to
    produce a continuous RSS / heapUsed / external / arrayBuffers time series.
  - Ships four built-in memory detectors: `memory-growth`, `large-allocator`,
    `external-buffer-pressure`, and the cross-kind `alloc-in-hot-path`.
  - Opt-in via `--kind memory` (or `--kind cpu memory`); the default capture
    remains `cpu` only.

### Patch Changes

- Updated dependencies [d694c2f]
  - @lanterna-profiler/core@1.3.0

## 1.2.0

### Minor Changes

- 6f6c5dc: Make Lanterna kind-extensible end-to-end so heap, async, IO and other future profile kinds can be added without touching core or the CLI.

  ## Breaking changes

  ### Report schema (`meta`)

  CPU-flavoured fields were moved out of `meta`'s top level into the per-kind bucket. Consumers reading the JSON must update their paths:

  | Before                                  | After                                          |
  | --------------------------------------- | ---------------------------------------------- |
  | `meta.totalSamples`                     | `meta.kinds.cpu.samplesTotal`                  |
  | `meta.sampleIntervalMicros`             | `meta.kinds.cpu.sampleIntervalMicros`          |
  | `meta.deep`                             | `meta.kinds.cpu.deep`                          |
  | `meta.captureIntegrity.cpuSamplesTimed` | `meta.captureIntegrity.kinds.cpu.samplesTimed` |

  New top-level fields: `meta.kinds: Record<string, unknown>` and `meta.captureIntegrity.kinds: Record<string, unknown>`. Each `ProfileKind` contributes its own bucket via `contributeMeta` / `contributeIntegrity`.

  ### Removed exports

  - `@lanterna-profiler/core`: `createDefaultKindRegistry` (use `createKindRegistry([...])` directly).
  - `@lanterna-profiler/detectors`: `Detector`, `FindingContext`, `CpuDetectorReport`, `createFindingAnalyzerFromDetector`, `buildFindingContext` (all replaced by the kind-scoped seam below).

  ### Renamed / reshaped APIs

  - `runProfile({ analyzers })` → `runProfile({ extraAnalyzers })` (idem `attachProfile`). The kinds you pass already carry their built-in analyzers via `kind.builtInAnalyzers`; `extraAnalyzers` only supplements them.
  - `runCapture({ probeOptions })` → field removed. Each kind closes over its probe options at construction. `KindProbeOptions` no longer exists, and `ProfileKind.createProbe()` takes no arguments.
  - `CpuKindOptions` now accepts `sampleIntervalMicros?` and `deep?` (defaults `1000us` / `false`) directly — pass them when you build the CPU kind.
  - `buildLanternaReport(bundle, analysis, ['cpu'], options)` → `buildLanternaReport(bundle, analysis, kinds: ProfileKind[], options)`.
  - `serializeReport(report, { pretty })` → `serializeReport(report, { pretty, kinds })` (the Zod schema is composed from the active kinds).
  - `analyzeCapture(bundle, options)` (`@lanterna-profiler/detectors`) → `analyzeCapture(bundle, options, kinds)`. The pipeline is built per call (kind options live in the kind closure, so the previous singleton couldn't service different runs).
  - `createDefaultAnalysisPipeline()` (both packages) now requires `kinds: ProfileKind[]` — the implicit CPU default is gone.
  - `AnalysisOptions` is reduced to `{ command, mode? }`. CPU-specific fields (`sampleIntervalMicros`, `deep`) were closures-on-the-kind already; they're no longer leaked into the analysis context.

  ## New features

  - **`KindScopedDetector<K extends keyof ProfileSectionMap>`** in `@lanterna-profiler/core`: typed, multi-kind first-class detector seam. Pair with `createFindingAnalyzerFromKindScopedDetector(detector)` to register on a pipeline. Detectors receive a typed `{ [kindId]: { report, view } }` record plus a crosscutting `shared: { findings, meta }`.
  - **`createCpuProfileKindWithBuiltInDetectors(opts)`** + **`withBuiltInCpuDetectors(kind)`** in `@lanterna-profiler/detectors`: one-shot factory and composable wrapper that pre-attach the default CPU detector pack via `kind.builtInAnalyzers`. The CLI uses these directly — no more `kind.id === 'cpu'` switch.
  - **Dynamic Zod schema**: `buildReportSchema(kinds)` composes the report schema from each kind's `reportSchema`. Adding a new kind no longer requires editing the central schema file.
  - **`ProfileKind` extension surface**: `reportSchema` (required), `contributeMeta`, `contributeIntegrity`, `builtInAnalyzers` (optional). Each kind contributes its meta/integrity fields under its own namespace and ships its default analyzers.
  - **Plugin loader for kinds**: a CLI plugin module (loaded via `--detectors <pkg>` or `.lanterna.json`) can now export `kinds: ProfileKind[]` (named export) in addition to / instead of the default-exported pipeline setup. The CLI registers plugin kinds before resolving `--kind <id>`, so a plugin package can ship a brand-new kind end-to-end.
  - **`CpuHotspotContext`** type exported from `@lanterna-profiler/detectors` — the attribution view (`fullHotspots`, `hotspotById`, `userAttributionById`) shared helpers expect; reachable via `kinds.cpu.view.hotspotAnalysis` from a kind-scoped detector.

  ## Migration

  ### Programmatic CPU profiling

  ```diff
  -import { runProfile } from '@lanterna-profiler/core';
  -import { createBuiltInFindingAnalyzers } from '@lanterna-profiler/detectors';
  +import { runProfile } from '@lanterna-profiler/core';
  +import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

  +let stderr = '';
   const report = await runProfile({
     command: ['node', 'app.js'],
     durationMs: 15_000,
  -  sampleIntervalMicros: 1000,
  -  deep: false,
     pretty: true,
  -  analyzers: createBuiltInFindingAnalyzers(),
  +  kinds: [
  +    createCpuProfileKindWithBuiltInDetectors({
  +      readStderrSoFar: () => stderr,
  +      sampleIntervalMicros: 1000,
  +      deep: false,
  +    }),
  +  ],
   });
  ```

  ### Custom CPU detector

  ```diff
  -import { createFindingAnalyzerFromDetector, type Detector } from '@lanterna-profiler/detectors';
  +import {
  +  createFindingAnalyzerFromKindScopedDetector,
  +  type KindScopedDetector,
  +} from '@lanterna-profiler/core';

  -const myDetector: Detector = {
  -  id: 'my-rule',
  -  detect(report, context) { /* report.hotspots, context.fullHotspots */ },
  -};
  +const myDetector: KindScopedDetector<'cpu'> = {
  +  id: 'my-rule',
  +  kindIds: ['cpu'],
  +  detect({ cpu }) {
  +    /* cpu.report.hotspots, cpu.view.hotspotAnalysis.fullHotspots */
  +  },
  +};

  -pipeline.register(createFindingAnalyzerFromDetector(myDetector));
  +pipeline.register(createFindingAnalyzerFromKindScopedDetector(myDetector));
  ```

  ### Reading meta from a JSON report

  ```diff
  -const samplesTotal = report.meta.totalSamples;
  -const sampleIntervalMicros = report.meta.sampleIntervalMicros;
  -const deep = report.meta.deep;
  -const samplesTimed = report.meta.captureIntegrity.cpuSamplesTimed;
  +const samplesTotal = report.meta.kinds.cpu.samplesTotal;
  +const sampleIntervalMicros = report.meta.kinds.cpu.sampleIntervalMicros;
  +const deep = report.meta.kinds.cpu.deep;
  +const samplesTimed = report.meta.captureIntegrity.kinds.cpu.samplesTimed;
  ```

  ### Plugin module shape (CLI)

  ```ts
  // A plugin can now publish a kind alongside (or instead of) a setup function.
  import type { ProfileKind } from "@lanterna-profiler/core";
  import type { LanternaDetectorPlugin } from "@lanterna-profiler/detectors";

  export const kinds: ProfileKind[] = [
    /* createMyProfileKindWithBuiltInDetectors(...) */
  ];
  const register: LanternaDetectorPlugin = (pipeline, ctx) => {
    /* register cross-cutting analyzers */
  };
  export default register;
  ```

  `lanterna run --kind <id> --detectors <pkg>` then resolves `<id>` against the plugin-provided kinds before capture starts.

### Patch Changes

- Updated dependencies [6f6c5dc]
  - @lanterna-profiler/core@1.2.0

## 1.1.0

### Minor Changes

- 72a7112: Move profile orchestration into `@lanterna-profiler/core` and narrow `@lanterna-profiler/detectors` to the default CPU detector pack.

  - `@lanterna-profiler/core`: expose `runProfile`, `attachProfile`, `createDefaultKindRegistry`, `createDefaultAnalysisPipeline`, and plugin/pipeline orchestration types; split capture coordinator internals and report schema modules while keeping report schema v2 stable.
  - `@lanterna-profiler/detectors`: remove `runProfile`, `attachProfile`, and `createDefaultKindRegistry` exports; keep built-in detector analyzers, detector adapters, thresholds, and plugin helper types.
  - `@lanterna-profiler/cli`: call profile orchestration from `@lanterna-profiler/core` and use `@lanterna-profiler/detectors` only to register default analyzers.

### Patch Changes

- Updated dependencies [72a7112]
  - @lanterna-profiler/core@1.1.0

## 1.0.1

### Patch Changes

- 1da85f7: Improve attach capture lifecycle reliability and progress reporting.

  - `@lanterna-profiler/core`: add a guarded internal capture session so CDP connections are closed and sources are finalized on post-connect failures; expose structured non-fatal capture diagnostics under `meta.captureIntegrity.diagnostics`; add attach runtime-hook, inspector discovery, and PID metadata timeouts with CDP cleanup when targets do not answer; remove temporary spawn preload files on startup failures; clear termination wait timers while rereading real child exit state; and emit `start-capture`, `capture-running`, and `finalize-capture` progress from real capture checkpoints rather than display timing.
  - `@lanterna-profiler/cli`: share run/attach command execution through a common profile-command helper, remove command-level `process.exit(0)`, and handle interactive attach cancellation through `main` with `process.exitCode`.
  - `@lanterna-profiler/detectors`: expose a grouped `extensionApi` surface; forward capture lifecycle progress without delayed duplicate finalization updates; and add extension-contract coverage for duplicate kind, section analyzer, and finding analyzer registrations plus non-fatal analyzer diagnostics.

- Updated dependencies [1da85f7]
  - @lanterna-profiler/core@1.0.1

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

### Patch Changes

- Updated dependencies [a06f9c3]
  - @lanterna-profiler/core@1.0.0

## 0.1.1

### Patch Changes

- 6ab5305: Improve profiler reports with schema metadata, correlation scoring, hot-stack clusters, runtime integrity signals, and structured finding measurements/remediation. Detector output is also more focused, with blocking calls grouped by API family and generic CPU-bound findings removed to reduce duplicate or low-actionability results.
- Updated dependencies [6ab5305]
  - @lanterna-profiler/core@0.1.1
