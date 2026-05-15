# @lanterna-profiler/detectors

## 2.2.0

### Minor Changes

- c68e1de: Harden profiling reports and detector attribution.

  - Add richer CPU, memory, and async report signals for agent-oriented review.
  - Add generic CPU hotspot detection and improve source-aware attribution for built-in detectors.
  - Improve agent/text/markdown report output with user stacks, read-first targets, and clearer quality caveats.

### Patch Changes

- Updated dependencies [c68e1de]
  - @lanterna-profiler/core@2.2.0

## 2.1.1

### Patch Changes

- 7c5fceb: Improve CPU hot-path diagnostics for synchronous crypto findings. Source map integrity now distinguishes non-applicable plain JavaScript from failed source-map resolution, CPU attribution exposes user caller candidates with stack distance, event-loop stall evidence reports heartbeat sample coverage, and CLI report formats surface the new reliability signals.
- Updated dependencies [7c5fceb]
  - @lanterna-profiler/core@2.1.1

## 2.1.0

### Minor Changes

- 81f7258: Align CLI, core, and detectors with schema v2, improve experimental async terminology, and refine memory growth suggestions.

### Patch Changes

- Updated dependencies [81f7258]
  - @lanterna-profiler/core@2.1.0

## 2.0.1

### Patch Changes

- 6c08ccb: Rewrite the agent report format around YAML frontmatter, a `## Findings` table with a `decision` column, and per-kind review tables so agents can analyze a profile end-to-end without falling back to raw JSON. Source-mapped locations and user-caller attribution are surfaced uniformly across CPU, memory, and async kinds.

  Improve async detector evidence so agent reports can surface user-code attribution for long async operations.

## 2.0.0

### Major Changes

- 0584584: Unify user-code attribution under `UserCallerAttribution` and broaden coverage.

  - New `userCaller?: UserCallerAttribution` exposed on `MemorySummary.topAllocator` and `AsyncSummary.topAsyncHotFile` (already on `Hotspot`, `MemoryHotAllocator`, `AsyncTopOperation`, `AsyncCpuAttributionEntry`, `AsyncHotFile`).
  - **Breaking** (core, detectors): `findings[].evidence.extra.userAttribution` (shape `HotspotAttributionEvidence`) replaced by `findings[].evidence.extra.userCaller` (shape `UserCallerAttribution`). Field `samplePct` becomes `profilePct`; `basis` is added (`cpu-sample-path`); `confidence` is widened to `'low' | 'medium' | 'high'`.
  - **Breaking** (core): `HotspotAttributionEvidence` and the `HotspotAttribution` type export are removed. The internal map `CpuAnalysisView.hotspotAnalysis.userAttributionById` is renamed to `userCallerById` and now stores `UserCallerAttribution`.
  - CLI text and markdown renderers now render the async profile (top operations, hot files, CPU attribution) and surface `userCaller` everywhere it appears.

### Patch Changes

- Updated dependencies [0584584]
  - @lanterna-profiler/core@2.0.0

## 1.5.2

### Patch Changes

- d28f033: Resolve generated `file:line` back to original sources via source maps. Hotspots, hot stacks, summary, memory allocators, async frames and finding evidence now carry an optional `source: { file, line, column?, name? }` field when a map is available. Discovery covers sibling `.map` files and inline `data:` URLs; remote schemes are skipped. Coverage and failures are reported under `meta.captureIntegrity.sourceMaps`. Disable with `--no-source-maps`. Text and Markdown renderers surface source-map coverage and prefer original source locations while keeping generated positions visible. See [docs/source-maps.md](https://github.com/arkerone/lanterna/blob/main/docs/source-maps.md).
- Updated dependencies [d28f033]
  - @lanterna-profiler/core@1.9.0

## 1.5.1

### Patch Changes

- 19ff05c: Restructure documentation: split docs into per-topic and per-kind files (`docs/getting-started.md`, `docs/cli.md`, `docs/configuration.md`, `docs/programmatic-api.md`, `docs/report-schema.md`, `docs/reading-a-report.md`, `docs/signal-quality.md`, `docs/architecture.md`, `docs/troubleshooting.md`, `docs/kinds/{cpu,memory,async}.md`, `docs/extending/{detectors,profile-kinds,plugin-loading}.md`). Root README and package READMEs become concise landing pages pointing to the new structure. Update package descriptions to reflect that Lanterna covers CPU, memory and async profiling. No runtime changes.
- Updated dependencies [19ff05c]
  - @lanterna-profiler/core@1.7.1

## 1.5.0

### Minor Changes

- 13d0b08: Add a third profile kind `async` (experimental and combinable with `cpu` and `memory` via `--kind`). It enables `Debugger.setAsyncCallStackDepth` over CDP and an `async_hooks` aggregator in the preload, producing a `profiles.async` section with per-resource records, async chain trees, concurrency timeline, quality metadata, and integrity counters.

  Five new detectors ship with it: `long-await`, `orphan-async-resource`, `deep-async-chain`, `microtask-flood`, and `hot-async-context`. New CLI options: `--async-max-events`, `--async-concurrency-interval`, `--async-stack-depth`, `--async-include-microtasks`, and `--async-instrumentation <off|safe|full>`.

  Async attach cleanup now tears down hooks and samplers, restores patched APIs, clears retained in-target state after reads, and allows a later async attach to reinstall hooks in the same target process. The CLI and docs mark `async` as experimental and warn that attach mode is partial because preexisting resources and already-loaded code cannot be fully observed.

### Patch Changes

- Updated dependencies [13d0b08]
  - @lanterna-profiler/core@1.7.0

## 1.4.2

### Patch Changes

- b727864: Improve maintainability by sharing CLI/config option normalization, deriving help from option descriptors, splitting capture coordination responsibilities, and tightening public surface/schema tests.
- Updated dependencies [b727864]
  - @lanterna-profiler/core@1.6.1

## 1.4.1

### Patch Changes

- a043cb5: Add package license files and tighten published package contents.
- Updated dependencies [a043cb5]
  - @lanterna-profiler/core@1.5.1

## 1.4.0

### Minor Changes

- c3e6c51: Add `ProfileQuality` to CPU reports (confidence, sample count, duration basis, idle ratio, reasons, recommendations) and `confidence` + `proofLevel` fields on findings. Built-in detectors populate the new signals and the CLI surfaces them in the `profile` command output.

### Patch Changes

- Updated dependencies [c3e6c51]
  - @lanterna-profiler/core@1.5.0

## 1.3.1

### Patch Changes

- 64deb49: Exclude Lanterna's own instrumentation from CPU and memory reports, and expose a registry so future profile kinds can declare their own self-noise.

  **What changes in reports**

  - New `'lanterna'` value in the `FrameCategory` enum (added to the report schema).
  - Frames originating from the spawn-injected preload tmpfile, any source under `runtime-signals/hooks/`, or `node_modules/@lanterna/*` / `node_modules/@lanterna-profiler/*` are tagged `lanterna` and dropped from `profiles.cpu.hotspots`, `profiles.cpu.hotStacks`, and `profiles.memory.hotAllocators`.
  - `profiles.cpu.summary` ratios subtract Lanterna samples from the denominator so they describe the profiled application, not the profiler.
  - Heap-snapshot retainer paths are filtered when they route through `__LANTERNA_*` globals or through `node:perf_hooks`' internal `kObservers` Set (the `PerformanceObserver` registered by the event-loop hook). `growthByConstructor` entries whose retainer paths were all attributed to a noise source are cascade-pruned.
  - Set `LANTERNA_DEBUG_SELF=1` to disable every filter at once when working on Lanterna itself.

  **New public API (`@lanterna-profiler/core`)**

  `registerNoiseFilter`, `getRegisteredNoiseFilters`, `classifyNoiseUrl`, `classifyNoisePackage`, `isNoiseCategory`, `isNoiseRetainerPath`, `shouldKeepNoiseFrames`, plus the `NoiseFilter` and `NoiseUrlMatch` types. The bundled Lanterna filter is auto-registered; a future profile kind that injects JS into the target can call `registerNoiseFilter({...})` to declare its own preload, hooks, and retainer signatures without touching the analyzers.

  **Detectors**

  Defense in depth: `aggregateByPatterns` now skips noise categories unconditionally even if a caller passes a permissive `categories` list.

- Updated dependencies [64deb49]
  - @lanterna-profiler/core@1.4.0

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
