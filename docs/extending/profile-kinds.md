# Writing a Profile Kind

A **profile kind** is a new axis of measurement: it captures its own data, contributes its own report section under `profiles.<reportSectionKey>.*`, and (optionally) ships its own detectors. CPU, memory and async use matching kind ids and report section keys, and serve as reference implementations.

When you only want a new **rule** on existing data, write a detector instead — see [detectors.md](./detectors.md).

## Anatomy

A `ProfileKind<TData>` provides:

| Field | Purpose |
| --- | --- |
| `id` | Stable kind id (`'cpu'`, `'memory'`, `'async'`, `'heap'`, …). Used on the CLI as `--kind <id>` and in `meta.profileKinds`. |
| `reportSectionKey` | Key under `report.profiles.*`. Usually equal to `id`. |
| `reportSchema` | Zod schema validating `profiles.<reportSectionKey>.*`. Composed dynamically by `buildReportSchema(kinds)`. |
| `createProbe()` | Factory returning a `CaptureProbe<TData>` that drives the live target via CDP and returns the raw kind data. |
| `createAnalysisContributor()` | Factory returning a `KindAnalysisContributor<TData>` that turns raw data into the `profiles.<reportSectionKey>.*` section and a typed view. |
| `label?` | Human-readable label for logs and help. |
| `hookInstaller?` | Optional preload-script fragment composed into the runtime hook (for kinds that need in-target instrumentation). |
| `contributeMeta?(data)` | Optional contribution merged under `meta.kinds.<id>.*`. |
| `contributeIntegrity?(data)` | Optional contribution merged under `meta.captureIntegrity.kinds.<id>.*`. |
| `builtInAnalyzers?` | Detectors that ship with the kind. `runProfile` flat-maps these. |
| `finalize?({ data, snapshot })` | Optional post-findings mutator (e.g. CPU sets `summary.dominantBlockingKind`). |
| `manualStopMessage?` | Optional message printed when the user manually stops this kind. |

The probe and contributor are **factories** so each capture run gets a fresh instance — singletons would not service different runs.

## Module augmentation

Kinds extend two registries via TypeScript module augmentation so analyzers receive properly typed views:

```ts
declare module '@lanterna-profiler/core' {
  interface CaptureKindDataMap {
    fs: FsKindData;       // raw probe output
  }
  interface ProfileSectionMap {
    fs: FsReportSection;  // shape under report.profiles.fs
  }
  interface KindViews {
    fs: FsAnalysisView;   // shape returned by context.forKind('fs')
  }
}
```

## Minimal example

```ts
import {
  defineProfileKind,
  type CaptureProbe,
  type KindAnalysisContributor,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { z } from 'zod';

interface FsEvent { path: string; bytes: number; }
interface FsKindData { events: FsEvent[]; }

interface FsReportSection { totalBytes: number; eventCount: number; }
interface FsAnalysisView { byPath: Map<string, number>; }

const fsReportSchema = z.object({
  totalBytes: z.number(),
  eventCount: z.number(),
});

function createFsProbe(): CaptureProbe<FsKindData> {
  return {
    async install(ctx) {
      await ctx.cdp.send('Runtime.enable');
    },
    async start(ctx) {
      /* enable a CDP domain, install in-target listeners, etc. */
    },
    async stop(ctx) {
      /* drain buffers */
      return { events: [/* ... */] };
    },
    async dispose(ctx) {
      if (!ctx.cdp.closed) {
        /* remove listeners, disable CDP domains, clear in-target timers */
      }
    },
  };
}

function createFsAnalysisContributor(): KindAnalysisContributor<FsKindData> {
  return {
    analyze(ctx) {
      const totalBytes = ctx.data.events.reduce((acc, e) => acc + e.bytes, 0);
      ctx.writeSection<FsReportSection>({
        totalBytes,
        eventCount: ctx.data.events.length,
      });
      ctx.setContextView<FsAnalysisView>({
        byPath: groupByPath(ctx.data.events),
      });
    },
  };
}

export function createFsProfileKind(): ProfileKind<FsKindData> {
  return defineProfileKind<FsKindData>({
    id: 'fs',
    label: 'Filesystem',
    reportSectionKey: 'fs',
    reportSchema: fsReportSchema,
    createProbe: createFsProbe,
    createAnalysisContributor: createFsAnalysisContributor,
    contributeMeta: (data) => ({ events: data.events.length }),
  });
}
```

After registration, `lanterna run --kind fs -- node app.js` populates `profiles.fs.{ totalBytes, eventCount }`. Detectors with `kindIds: ['fs']` receive the view via `kinds.fs.view`.

## `KindAnalysisContext`

Inside `analyze(ctx)`, the context exposes:

| Member | Use |
| --- | --- |
| `ctx.data: TData` | Raw probe output. |
| `ctx.bundle: CaptureBundle` | Full capture bundle (cross-kind data, runtime signals, integrity). |
| `ctx.analysis: AnalysisContext` | Cross-cutting analysis state (target metadata, durations, frame classification, …). |
| `ctx.options: AnalysisOptions` | The user-provided options for this run. |
| `ctx.sectionKey: string` | The report section key (mirrors `reportSectionKey`). |
| `ctx.writeSection<T>(section)` | Publishes the report section under `report.profiles[sectionKey]`. |
| `ctx.setContextView<V>(view)` | Publishes the typed view retrievable via `context.forKind(kindId)` and the `kinds.<id>.view` shape kind-scoped detectors receive. |

Kinds typically write the section first, then publish the view.

## `CaptureProbe`

```ts
export interface CaptureProbe<TData> {
  stopTimeoutMs?: number | false;
  disposeTimeoutMs?: number | false;
  progressMessages?: { start?: string; stop?: string; dispose?: string };

  install?(ctx: ProbeLifecycleContext): Promise<void>;
  start(ctx: ProbeLifecycleContext & { abortSignal?: AbortSignal }): Promise<void>;
  stop(ctx: ProbeLifecycleContext & {
    abortSignal?: AbortSignal;
    stopReason?: 'exit' | 'timeout' | 'signal';
  }): Promise<TData>;
  dispose?(ctx: ProbeLifecycleContext & {
    abortSignal?: AbortSignal;
    stopReason?: 'exit' | 'timeout' | 'signal';
    stopSucceeded: boolean;
  }): Promise<void>;
}

export interface ProbeLifecycleContext {
  cdp: CdpClient;
  mode: 'spawn' | 'attach';
  kindId: string;
}
```

- `install` runs once before `start`. Use it to enable CDP domains (`Profiler.enable`, `HeapProfiler.enable`, …) and register listeners that must be active before user code runs.
- `start` is called when the capture window opens (after `--wait-for-url` and `--capture-delay` if set).
- `stop` is called when the duration expires, the target exits, or the user signals. Return the raw kind data.
- `dispose` is best-effort cleanup and is called after `stop` for every installed probe, even when `start` or `stop` failed. Dispose failures do not discard collected data; they are recorded under `meta.captureIntegrity.diagnostics[]` with `stage: "probe-dispose"`.

Use `ctx.mode` to choose cleanup aggressiveness. Attach-mode probes should remove timers, listeners, monkey patches, and CDP domain state because the target continues running. Spawn-mode probes should still clean up, but the target process often exits soon after capture.

For in-target hook fragments, use the runtime framework cleanup API:

```js
__lanterna.addDisposeHook(() => {
  clearInterval(timer);
  observer.disconnect();
  delete globalThis.__MY_KIND__;
});
```

The coordinator also calls `globalThis.__LANTERNA_ATTACH_RUNTIME__.dispose()` at the end of each capture. Built-in runtime signals and the memory/async installers use this to stop heartbeat, GC observation, histograms, memory usage intervals, and async instrumentation without the coordinator knowing installer internals.

## Hook installer (in-target instrumentation)

Kinds that need to observe the target from inside (`async_hooks`, `monitorEventLoopDelay`, `PerformanceObserver`, …) contribute a hook fragment that the capture coordinator composes into the preload script.

```ts
import { defineProfileKind } from '@lanterna-profiler/core';

export const myKind = defineProfileKind({
  id: 'my-kind',
  reportSectionKey: 'my-kind',
  // ... reportSchema, createProbe, createAnalysisContributor
  hookInstaller: {
    name: 'my-kind',
    setup: () => `
      // Injected into a CommonJS preload (.cjs) loaded before user code.
      // Can require() Node builtins and publish globals the parent reads
      // back over CDP.
      const counters = { reads: 0, writes: 0 };
      globalThis.__MY_KIND__ = counters;
      // ... install listeners
    `,
  },
});
```

> The preload extension is `.cjs` because Lanterna's package is `"type": "module"`. A `.js` preload would be loaded as ESM and `require()` would not work in it. Mechanical detail of composition.

If your kind injects its own JavaScript and you want its frames out of hotspots, register a noise filter — see [../architecture.md](../architecture.md#noise-filters-extension-point).

## Pre-wiring detectors

Following the built-in pattern, ship `withBuiltInMyKindDetectors(kind)` and `createMyKindProfileKindWithBuiltInDetectors(opts)`:

```ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  type ProfileKind,
} from '@lanterna-profiler/core';
import { fsHotPathDetector } from './detectors/fs-hot-path.js';
import { createFsProfileKind, type FsKindData } from './kind.js';

export function withBuiltInFsDetectors(
  kind: ProfileKind<FsKindData>,
): ProfileKind<FsKindData> {
  return {
    ...kind,
    builtInAnalyzers: [
      ...(kind.builtInAnalyzers ?? []),
      createFindingAnalyzerFromKindScopedDetector(fsHotPathDetector),
    ],
  };
}

export function createFsProfileKindWithBuiltInDetectors(): ProfileKind<FsKindData> {
  return withBuiltInFsDetectors(createFsProfileKind());
}
```

`runProfile` flat-maps every kind's `builtInAnalyzers`, so users only register the kind — no separate `analyzers` injection.

## Publishing as a plugin

A plugin module can publish a brand-new kind by exporting `kinds: ProfileKind[]` (named) alongside (or instead of) a default-exported `setupPipeline`:

```ts
// @acme/lanterna-kinds-fs/src/index.ts
import type { ProfileKind } from '@lanterna-profiler/core';
import { createFsProfileKindWithBuiltInDetectors } from './kind.js';

export const kinds: ProfileKind[] = [
  createFsProfileKindWithBuiltInDetectors(),
];
```

`lanterna run --kind fs --detectors @acme/lanterna-kinds-fs -- node app.js` then captures `fs` alongside CPU. See [plugin-loading.md](./plugin-loading.md) for the loader contract.

## Programmatic registration

If you do not want to publish a plugin, register kinds at call time:

```ts
import { runProfile } from '@lanterna-profiler/core';
import { createFsProfileKind } from './kind.js';

await runProfile({
  command: ['node', 'app.js'],
  durationMs: 30_000,
  pretty: false,
  kinds: [createFsProfileKind()],
});
```

Or build a registry up-front:

```ts
import { createKindRegistry } from '@lanterna-profiler/core';
const registry = createKindRegistry([createFsProfileKind() /* , other kinds */]);
const resolved = registry.resolveMany(['fs', 'cpu']);
```

## Reference implementations

Read these as templates — they are battle-tested and exercise every extension point:

- `packages/core/src/kinds/cpu/` — runtime hook (event loop + GC), CDP probe (`Profiler.start/stop`), section contributor, frame classification.
- `packages/core/src/kinds/memory/` — heap sampling probe, RSS series, optional heap snapshot driver, `memoryUsage` series.
- `packages/core/src/kinds/async/` — async resource hook, concurrency sampler, instrumentation modes (`safe` / `full`), partial-capture quality flag.

## See also

- [detectors.md](./detectors.md) — when you only need rules, not a new measurement axis.
- [plugin-loading.md](./plugin-loading.md) — packaging and resolution order.
- [../programmatic-api.md](../programmatic-api.md) — using kinds directly via `runProfile`.
- [../architecture.md](../architecture.md) — capture flow and enrichment pipeline.
