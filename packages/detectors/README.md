# @lanterna-profiler/detectors

Default detector pack for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js profiler.

This package contains the built-in CPU, memory, and experimental async detectors, thresholds, attribution helpers, and kind factories that pre-wire those detectors. Capture orchestration and the `KindScopedDetector` seam itself live in [`@lanterna-profiler/core`](../core).

> Schema v2: kind data lives under `report.profiles.<kind>.*` and meta under `report.meta.kinds.<kind>.*`. Built-in kinds are `cpu`, `memory`, and experimental `async`. Programmatic runs should use `runProfile` / `attachProfile` from `@lanterna-profiler/core` and pass the `create*ProfileKindWithBuiltInDetectors(...)` factories you need.

## Install

```bash
npm install @lanterna-profiler/detectors
```

Install `@lanterna-profiler/core` as well when your application imports orchestration APIs such as `runProfile` / `attachProfile` directly.

## Built-in detectors

| Finding id | Trigger |
| --- | --- |
| `sync-crypto-on-hot-path` | Sampled sync crypto frame (`pbkdf2Sync`, `scryptSync`, …) with meaningful CPU. |
| `blocking-io:<api>` | Sampled sync fs / child_process / zlib frame. |
| `json-on-hot-path:<api>` | `JSON.parse` / `JSON.stringify` consuming meaningful CPU. |
| `node-modules-hotspot:<package>` | A dependency frame dominates CPU time. |
| `excessive-gc` | `gcRatio > 10%` or `longestPauseMs > 100ms`. |
| `event-loop-stall` | `p99LagMs >= 100` or `maxLagMs >= 200`. |
| `deopt-loop:<function>` | Same deoptimised function seen ≥ 5 times (`--deep`) and hot in the profile. |
| `require-in-hot-path` | Module loading functions sampled on the hot path. |
| `deep-async-chain` | Long async parent chains in `profiles.async.*` (`--kind async`, experimental). |
| `long-await` | Await gaps above detector thresholds (`--kind async`, experimental). |
| `orphan-async-resource` | Async resources that never resolved or destroyed during capture (`--kind async`, experimental). |

Thresholds live in `DETECTOR_THRESHOLDS` (exported from this package, not core).

## Usage - profile with built-in detectors

```ts
import { runProfile } from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

let diagnostics = '';
const report = await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  pretty: true,
  onTargetDiagnosticChunk: (chunk) => {
    diagnostics += chunk;
  },
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => diagnostics,
      sampleIntervalMicros: 1000,
      deep: true,
    }),
  ],
});

console.log(report.findings);
```

`createCpuProfileKindWithBuiltInDetectors(opts)` returns a `ProfileKind<CpuKindData>` whose `builtInAnalyzers` are this package's CPU detectors. `runProfile` flat-maps every kind's `builtInAnalyzers`, so you only need to register the kind — no separate `analyzers` injection.

If you enable `deep: true`, capture target diagnostics with `onTargetDiagnosticChunk` and append them to the buffer returned by `readStderrSoFar`; deopt parsing reads from that stream. Use `deep: false` and return an empty string when you do not collect it.

## Usage - analyze an existing capture

```ts
import { analyzeCapture } from '@lanterna-profiler/detectors';
import {
  buildLanternaReport,
  createCpuProfileKind,
  type CaptureBundle,
} from '@lanterna-profiler/core';

const bundle: CaptureBundle = /* from runCapture(...) */;
const cpuKind = createCpuProfileKind({
  readStderrSoFar: () => '',
  sampleIntervalMicros: 1000,
  deep: false,
});
const options = { command: ['node', 'app.js'], mode: 'spawn' as const };
const analysis = analyzeCapture(bundle, options, [cpuKind]);
const report = buildLanternaReport(bundle, analysis, [cpuKind], options);
```

`analyzeCapture` builds a fresh pipeline per call (kind options are closed over at construction, so a singleton would not service different runs).

## Exports

- `analyzeCapture(bundle, options, kinds)` — run the default pipeline (CPU built-in detectors + the kinds you pass) on a `CaptureBundle`.
- `createDefaultAnalysisPipeline(kinds)` — pre-populated pipeline (CPU built-ins + the kinds you pass) you can extend with `register(...)`.
- `createCpuProfileKindWithBuiltInDetectors(opts)` — one-shot factory: CPU `ProfileKind` pre-wired with `builtInAnalyzers`.
- `withBuiltInCpuDetectors(kind)` — composable form that takes an already-built CPU kind and attaches the built-in detectors.
- `defaultDetectors` — the raw `KindScopedDetector<'cpu'>` descriptors (for introspection or custom composition).
- `createBuiltInFindingAnalyzers()` — the same detectors wrapped as `FindingAnalyzer` instances.
- `buildAttributedFinding(...)` / `resolveAttribution(...)` / `buildAttributionEvidence(...)` — helpers for writing detectors that reuse Lanterna's hotspot attribution.
- `CpuHotspotContext` — the attribution view (`fullHotspots`, `hotspotById`, `userAttributionById`) detector helpers expect; reachable from a kind-scoped detector via `kinds.cpu.view.hotspotAnalysis`.
- `LanternaDetectorPlugin` / `LanternaPluginContext` — plugin contract types.
- `DETECTOR_THRESHOLDS` + threshold types.

## Writing a detector plugin

A detector plugin is an ES module. It can ship a default-exported pipeline-setup function, a named `kinds` array (to register new profile kinds), or both — the CLI loader handles whichever shape is exported.

```ts
// @acme/lanterna-detectors-prisma/src/index.ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  type KindScopedDetector,
} from '@lanterna-profiler/core';
import type { LanternaDetectorPlugin } from '@lanterna-profiler/detectors';

// Flag a Prisma client frame that eats too much CPU on the request path.
// `kinds.cpu.report` mirrors `snapshot.profiles.cpu.*`; the attribution helpers
// expect `kinds.cpu.view.hotspotAnalysis` (a `CpuHotspotContext`).
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
        why: 'Prisma serialization/query execution is on the hot path of a request.',
        suggestion: 'Batch queries with `prisma.$transaction`, add `select`/`include` projections, or cache repeated reads.',
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

Publish that module (e.g. `@acme/lanterna-detectors-prisma`) and users can load it from the CLI with `--detectors @acme/lanterna-detectors-prisma` or through `.lanterna.json`. See [`@lanterna-profiler/cli`](../cli) for CLI loading details, and [`@lanterna-profiler/core`](../core) for the pipeline / analyzer primitives.

### Publishing a profile kind

A plugin can also publish a brand-new kind alongside (or instead of) a setup function. Export `kinds: ProfileKind[]` and the CLI registers them in its kind registry before resolving `--kind`:

```ts
// @acme/lanterna-kinds-heap/src/index.ts
import type { ProfileKind } from '@lanterna-profiler/core';
import { createHeapProfileKindWithBuiltInDetectors } from './heap.js';

export const kinds: ProfileKind[] = [
  createHeapProfileKindWithBuiltInDetectors({ samplingIntervalBytes: 32_768 }),
];
```

`lanterna run --kind heap --detectors @acme/lanterna-kinds-heap -- node app.js` then captures heap alongside CPU (or in isolation). Mirror the `createCpuProfileKindWithBuiltInDetectors` pattern from this package: each kind owns its options (no global `probeOptions`) and bakes its built-in detectors via `withBuiltInCpuDetectors`-style composition.

Programmatically, combine `@lanterna-profiler/core` orchestration with kinds + extra analyzers:

```ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  runProfile,
} from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  pretty: false,
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => '',
      sampleIntervalMicros: 1000,
      deep: false,
    }),
    // myMemoryKind,                                // add custom kinds here
  ],
  extraAnalyzers: [
    createFindingAnalyzerFromKindScopedDetector(prismaHotspotDetector),
    myCustomSectionAnalyzer,
  ],
  setupPipeline: async (pipeline, ctx) => {
    // full-control hook
  },
});
```

## Related packages

- [`@lanterna-profiler/core`](../core) - capture orchestration, profile kinds, pipeline, kind-scoped detector seam, and report APIs.
- [`@lanterna-profiler/cli`](../cli) - `lanterna` binary built on top of this package.
