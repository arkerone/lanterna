# @lanterna-profiler/detectors

Default detector pack + ready-to-use profiling facades for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js profiler.

This is the **batteries-included** package: one function call captures a profile, runs the built-in detectors, and returns a structured `LanternaReport`. If you want the low-level primitives without the defaults, use [`@lanterna-profiler/core`](../core) directly.

> Schema v2: CPU data lives under `report.profiles.cpu.*`. `runProfile` / `attachProfile` accept a `kinds` option (default `[cpu]`). The kind registry (`createDefaultKindRegistry`) is the seam where future `memory`/`async` kinds will plug in.

## Install

```bash
npm install @lanterna-profiler/detectors
```

`@lanterna-profiler/core` is a direct dependency and comes along automatically.

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

Thresholds live in `DETECTOR_THRESHOLDS` (exported from this package, not core).

## Usage - one-shot profile

```ts
import { runProfile } from '@lanterna-profiler/detectors';

const report = await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  sampleIntervalMicros: 1000,
  deep: false,
  pretty: true,
});

console.log(report.findings);
```

## Usage - analyze an existing capture

```ts
import { analyzeCapture } from '@lanterna-profiler/detectors';
import { buildLanternaReport, type CaptureBundle } from '@lanterna-profiler/core';

const bundle: CaptureBundle = /* from runCapture(...) */;
const options = { sampleIntervalMicros: 1000, deep: false, command: ['node', 'app.js'], mode: 'spawn' as const };
const analysis = analyzeCapture(bundle, options);
const report = buildLanternaReport(bundle, analysis, ['cpu'], options);
```

## Exports

- `runProfile(options, onProgress?)` - spawn + capture + analyze + report.
- `attachProfile(options, onProgress?)` - attach to a running process + capture + analyze + report.
- `analyzeCapture(bundle, options)` - run the default pipeline on a `CaptureBundle`.
- `createDefaultAnalysisPipeline(extraKinds?)` - pre-populated pipeline (CPU kind + built-ins) you can extend with `register(...)`.
- `createDefaultKindRegistry(options?)` - `ProfileKindRegistry` pre-loaded with the CPU kind. Used by the CLI to resolve `--kind <id>`.
- `defaultDetectors` - the raw detector descriptors (for introspection or custom composition).
- `createBuiltInFindingAnalyzers()` - the same detectors wrapped as `FindingAnalyzer` instances.
- `createFindingAnalyzerFromDetector(detector)` - wrap a single `Detector` into a `FindingAnalyzer` (auto-tags findings with `profileKind: 'cpu'`).
- `buildFindingContext(context)` / `buildAttributedFinding(...)` / `resolveAttribution(...)` / `buildAttributionEvidence(...)` - helpers for writing detectors that reuse Lanterna's hotspot attribution.
- `LanternaDetectorPlugin` / `LanternaPluginContext` - plugin contract types.
- `DETECTOR_THRESHOLDS` + threshold types.

## Writing a detector plugin

A detector plugin is an ES module whose `default` export is a function that registers analyzers on a pipeline:

```ts
import type { Detector, LanternaDetectorPlugin } from '@lanterna-profiler/detectors';
import { createFindingAnalyzerFromDetector } from '@lanterna-profiler/detectors';

// Flag a Prisma client frame that eats too much CPU on the request path.
// `report` is the CPU-shaped view passed by the adapter — `report.hotspots`,
// `report.gc`, `report.eventLoop`, etc. mirror `snapshot.profiles.cpu.*`.
const prismaHotspotDetector: Detector = {
  id: 'prisma-hotspot:client',
  detect(report, context) {
    const findings = [];
    for (const hotspot of report.hotspots) {
      const isPrisma = hotspot.file.includes('node_modules/@prisma/client');
      if (!isPrisma || hotspot.totalPct < 8) continue;

      const attribution = context.userAttributionById.get(hotspot.id);
      findings.push({
        id: `prisma-hotspot:client:${hotspot.function}`,
        profileKind: 'cpu',
        severity: 'warning',
        category: 'prisma-hotspot',
        title: `Prisma client dominates CPU in ${hotspot.function}`,
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
  pipeline.register(createFindingAnalyzerFromDetector(prismaHotspotDetector));
};
export default register;
```

Publish that module (e.g. `@acme/lanterna-detectors-prisma`) and users can load it from the CLI with `--detectors @acme/lanterna-detectors-prisma` or through `.lanterna.json`. See [`@lanterna-profiler/cli`](../cli) for CLI loading details, and [`@lanterna-profiler/core`](../core) for the pipeline / analyzer primitives.

Programmatically, `runProfile` / `attachProfile` also accept custom detectors and extra kinds directly:

```ts
await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  sampleIntervalMicros: 1000,
  deep: false,
  pretty: false,
  // kinds: [cpuKind, myMemoryKind],            // override default; omit to get [cpu]
  detectors: [prismaHotspotDetector],           // auto-wrapped as FindingAnalyzers (tagged profileKind: 'cpu')
  analyzers: [myCustomSectionAnalyzer],         // raw analyzer registration
  setupPipeline: async (pipeline, ctx) => {
    // full-control hook - runs after detectors/analyzers are registered
  },
});
```

## Related packages

- [`@lanterna-profiler/core`](../core) - headless capture + pipeline primitives (no defaults).
- [`@lanterna-profiler/cli`](../cli) - `lanterna` binary built on top of this package.
