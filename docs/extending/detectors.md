# Writing a Detector Plugin

A **detector** is a rule that reads an enriched profile snapshot and emits one or more `Finding`s. Lanterna ships a default pack in [`@lanterna-profiler/detectors`](../../packages/detectors); third-party detectors are first-class and use the same primitives.

This page covers:

1. The plugin contract and how plugins are loaded.
2. Writing a kind-scoped detector (the typed, recommended path).
3. The built-in finding catalog you can use as inspiration.
4. Attribution helpers and threshold knobs.

For new **profile kinds** (a new axis of measurement, not just a new rule), see [profile-kinds.md](./profile-kinds.md). For how Lanterna discovers and loads plugins, see [plugin-loading.md](./plugin-loading.md).

## Plugin contract

A plugin is an ES module. It can ship any combination of:

- a **default export** matching `LanternaDetectorPlugin` — a function called with the analysis pipeline so it can register analyzers,
- a **named export** `kinds: ProfileKind[]` — additional profile kinds registered before `--kind <id>` is resolved.

A plugin must export at least one of the two.

```ts
import type { LanternaDetectorPlugin } from '@lanterna-profiler/detectors';
import type { ProfileKind } from '@lanterna-profiler/core';

const register: LanternaDetectorPlugin = (pipeline, ctx) => {
  pipeline.register(/* ... */);
};
export default register;

export const kinds: ProfileKind[] = [
  /* optional: brand-new kinds */
];
```

`pipeline` is the active `AnalysisPipeline`. `ctx` (`LanternaPluginContext`) gives access to capture options, kind registry, and helpers.

## Kind-scoped detector (recommended)

A `KindScopedDetector<K>` is the typed, ergonomic primitive: it declares which kinds it depends on, and its `detect` callback receives the snapshot pre-narrowed to those kinds.

```ts
// @acme/lanterna-detectors-prisma/src/index.ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  type KindScopedDetector,
} from '@lanterna-profiler/core';
import type { LanternaDetectorPlugin } from '@lanterna-profiler/detectors';

// Flag a Prisma client frame that eats too much CPU on the request path.
// `kinds.cpu.report` mirrors `snapshot.profiles.cpu.*`; the attribution
// helpers expect `kinds.cpu.view.hotspotAnalysis` (a `CpuHotspotContext`).
const prismaHotspotDetector: KindScopedDetector<'cpu'> = {
  id: 'prisma-hotspot:client',
  kindIds: ['cpu'],
  detect({ cpu }) {
    const findings = [];
    const userAttributionById = cpu.view.hotspotAnalysis.userAttributionById;

    for (const hotspot of cpu.report.hotspots) {
      const isPrisma = hotspot.file.includes('node_modules/@prisma/client');
      if (!isPrisma || hotspot.totalPct < 8) continue;

      const attribution = userAttributionById.get(hotspot.id);
      findings.push({
        id: `prisma-hotspot:client:${hotspot.function}`,
        profileKind: 'cpu',
        severity: 'warning',
        category: 'prisma-hotspot',
        title: `Prisma client dominates CPU in ${hotspot.function}`,
        confidence: attribution ? 'high' : 'medium',
        proofLevel: 'direct-sample',
        evidence: {
          file: attribution?.file ?? hotspot.file,
          line: attribution?.line ?? hotspot.line,
          function: attribution?.function ?? hotspot.function,
          selfPct: hotspot.selfPct,
          extra: { package: '@prisma/client', totalPct: hotspot.totalPct },
        },
        why: 'Prisma serialization or query execution is on the hot path of a request.',
        suggestion: 'Batch with `prisma.$transaction`, add `select`/`include` projections, or cache repeated reads.',
        references: ['https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance'],
      });
    }
    return findings;
  },
};

const register: LanternaDetectorPlugin = (pipeline) => {
  pipeline.register(createFindingAnalyzerFromKindScopedDetector(prismaHotspotDetector));
};
export default register;
```

Detectors against `memory` or `async` follow the same pattern — change `kindIds` and the destructured kind name in `detect`. A detector can declare multiple kinds:

```ts
const allocOnHotPath: KindScopedDetector<'cpu' | 'memory'> = {
  id: 'alloc-in-hot-path',
  kindIds: ['cpu', 'memory'],
  detect({ cpu, memory }) {
    if (!cpu || !memory) return []; // both required; auto-skipped otherwise
    /* ... */
  },
};
```

When a required kind is absent from the report, the detector is skipped. This is how `alloc-in-hot-path` works in the built-in pack.

## Untyped detectors

If you cannot use `KindScopedDetector<K>` (e.g. dynamic kind selection at runtime), drop down to `defineFindingAnalyzer`:

```ts
import { defineFindingAnalyzer } from '@lanterna-profiler/core';

pipeline.register(defineFindingAnalyzer({
  id: 'my.custom-rule',
  kind: 'finding',
  run(ctx, snapshot) {
    /* read snapshot.profiles.* directly */
    return [/* findings */];
  },
}));
```

`defineSectionAnalyzer` is the section-writer equivalent — use it to add `extensions.<namespace>` payloads instead of findings.

## Built-in findings

The default pack lives in `@lanterna-profiler/detectors` and pre-wires detectors per kind via `withBuiltIn{Cpu,Memory,Async}Detectors`. Use the table below as inspiration for your own rules.

### CPU detectors

| Finding id | Trigger |
| --- | --- |
| `sync-crypto-on-hot-path` | Sampled sync crypto frame (`pbkdf2Sync`, `scryptSync`, …) with meaningful CPU. |
| `blocking-io:<api>` | Sampled sync `fs` / `child_process` / `zlib` frame on the hot path. |
| `json-on-hot-path:<api>` | `JSON.parse` / `JSON.stringify` consuming meaningful CPU. |
| `node-modules-hotspot:<package>` | A dependency frame dominates CPU time. |
| `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms`. |
| `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200`. |
| `deopt-loop:<function>` | Same deoptimised function seen ≥ 5 times (`--deep`) and hot in the profile. |
| `require-in-hot-path` | Module loading functions sampled on the hot path. |

### Memory detectors

| Finding id | Trigger |
| --- | --- |
| `memory-growth:rss` / `memory-growth:heapUsed` | Sustained linear growth ≥ 1 MB/s (warning) or ≥ 5 MB/s (critical). |
| `large-allocator:<frame>` | A single frame accounts for ≥ 15 % of sampled allocations. |
| `external-buffer-pressure` | Mean `external` exceeds 0.5× `heapUsed` (and ≥ 32 MB absolute). |

### Async detectors (experimental)

| Finding id | Trigger |
| --- | --- |
| `deep-async-chain:<rootAsyncId>` | Async parent chain exceeds the configured depth threshold. |
| `long-await:<asyncId>` | An `await` boundary spent significantly longer than its peers. |
| `orphan-async-resource` | Async resources never resolved or destroyed during capture. |
| `microtask-flood` | Microtask volume crosses a per-window threshold (requires `--async-include-microtasks`). |
| `hot-async-context:<rootAsyncId>` | Same async context repeatedly entered. |

### Cross-kind

| Finding id | Trigger |
| --- | --- |
| `alloc-in-hot-path:<frame>` | Same frame hot on CPU **and** in top allocators. Requires `--kind cpu memory`. |

## Attribution helpers

Several detectors point `evidence.file` at the **user caller** rather than the builtin callee. Use the shared helpers so your detector inherits the same heuristic.

```ts
import {
  buildAttributedFinding,
  resolveAttribution,
  buildAttributionEvidence,
  type CpuHotspotContext,
} from '@lanterna-profiler/detectors';
```

- `resolveAttribution(hotspot, ctx)` — walks callers to find the user-code frame responsible for invoking a builtin or dependency hotspot.
- `buildAttributionEvidence(...)` — assembles the `evidence` object with caller file/line plus `extra`.
- `buildAttributedFinding(...)` — one-shot helper that returns a fully-shaped `Finding`.
- `CpuHotspotContext` — the attribution view (`fullHotspots`, `hotspotById`, `userAttributionById`) reachable from a kind-scoped detector via `kinds.cpu.view.hotspotAnalysis`.

## Thresholds

`DETECTOR_THRESHOLDS` from `@lanterna-profiler/detectors` is the source of truth for tunable values:

```ts
import { DETECTOR_THRESHOLDS } from '@lanterna-profiler/detectors';

console.log(DETECTOR_THRESHOLDS.eventLoop.p99LagWarningMs);
```

You can read these values in your own detectors so users get consistent thresholds across the pack.

## Where to next

- [plugin-loading.md](./plugin-loading.md) — how Lanterna discovers your plugin (CLI flag, `.lanterna.json`, packaging).
- [profile-kinds.md](./profile-kinds.md) — when you need a brand-new measurement axis.
- [../programmatic-api.md](../programmatic-api.md) — using detectors directly via `runProfile` `extraAnalyzers`.
