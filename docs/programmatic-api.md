# Programmatic API

The CLI is a thin wrapper around [`@lanterna-profiler/core`](../packages/core). Use the API directly when you need to embed Lanterna in a script, a CI step, or a service.

> The default detector pack lives in [`@lanterna-profiler/detectors`](../packages/detectors). `core` itself ships no detectors so it stays minimal.

## Install

```bash
npm install @lanterna-profiler/core @lanterna-profiler/detectors
```

## High-level: `runProfile` and `attachProfile`

The simplest entry points. They orchestrate capture, analysis, and report construction in one call and return a `LanternaReport`.

```ts
import { runProfile, type LanternaReport } from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

let diagnostics = '';
const report: LanternaReport = await runProfile({
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
```

`attachProfile(...)` has the same shape but takes `pid` or `inspectUrl` instead of `command`:

```ts
import { attachProfile } from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

const report = await attachProfile({
  pid: 4242,
  durationMs: 15_000,
  pretty: false,
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => '',
      sampleIntervalMicros: 1000,
      deep: false,
    }),
  ],
});
```

### Combining kinds

Pass several kinds to capture them in a single run:

```ts
import { runProfile } from '@lanterna-profiler/core';
import {
  createCpuProfileKindWithBuiltInDetectors,
  createMemoryProfileKindWithBuiltInDetectors,
  createAsyncProfileKindWithBuiltInDetectors,
} from '@lanterna-profiler/detectors';

const report = await runProfile({
  command: ['node', 'app.js'],
  durationMs: 30_000,
  pretty: false,
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => '',
      sampleIntervalMicros: 1000,
      deep: false,
    }),
    createMemoryProfileKindWithBuiltInDetectors({
      samplingIntervalBytes: 512 * 1024,
      memoryUsageIntervalMs: 250,
    }),
    createAsyncProfileKindWithBuiltInDetectors({
      maxRecords: 50_000,
      asyncStackDepth: 32,
      instrumentationMode: 'safe',
    }),
  ],
});
```

Each `create*ProfileKindWithBuiltInDetectors` factory returns a `ProfileKind` whose `builtInAnalyzers` are this package's detectors. `runProfile` flat-maps every kind's `builtInAnalyzers`, so you only need to register the kind — no separate `analyzers` injection.

> **Diagnostic stream and `--deep`.** When you enable `deep: true`, also pass `onTargetDiagnosticChunk` and append chunks to the buffer read by `readStderrSoFar`; deopt parsing depends on those target diagnostics. Leave `deep: false` and return an empty string when you do not collect that stream.

### Adding custom analyzers at call time

Both `runProfile` and `attachProfile` accept extension hooks:

```ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  runProfile,
} from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';
import { myDetector, mySectionAnalyzer } from './my-rules.js';

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
  ],
  extraAnalyzers: [
    createFindingAnalyzerFromKindScopedDetector(myDetector),
    mySectionAnalyzer,
  ],
  setupPipeline: async (pipeline, ctx) => {
    // full-control hook: register analyzers, mutate options, etc.
  },
});
```

If you want to publish those rules as a reusable plugin instead of injecting them per call, see [extending/detectors.md](./extending/detectors.md).

## Low-level: `runCapture` + `createAnalysisPipeline`

Use the low-level API when you need full control over capture and analysis — e.g. to capture once and run several pipelines, or to ship a custom `ProfileSource`.

```ts
import {
  buildLanternaReport,
  createAnalysisPipeline,
  createCpuProfileKind,
  defineFindingAnalyzer,
  runCapture,
  serializeReport,
  SpawnSource,
  type CaptureBundle,
} from '@lanterna-profiler/core';

const cpuKind = createCpuProfileKind({
  readStderrSoFar: () => '',
  sampleIntervalMicros: 1000,
  deep: false,
});

const bundle: CaptureBundle = await runCapture({
  source: new SpawnSource(),
  sourceOptions: { command: ['node', 'app.js'] },
  kinds: [cpuKind],
  durationMs: 15_000,
});

const pipeline = createAnalysisPipeline({ kinds: [cpuKind] });
pipeline.register(defineFindingAnalyzer({
  id: 'my.custom-rule',
  kind: 'finding',
  run(ctx, snapshot) {
    const top = snapshot.profiles.cpu?.hotspots[0];
    if (!top || top.selfPct < 40) return [];
    return [{
      id: 'my.custom-rule',
      profileKind: 'cpu',
      severity: 'warning',
      category: 'my.custom-rule',
      title: `Hot function dominates CPU: ${top.function}`,
      confidence: 'medium',
      proofLevel: 'direct-sample',
      evidence: { file: top.file, line: top.line, function: top.function, selfPct: top.selfPct, extra: {} },
      why: 'Single function owns >40% of self CPU.',
      suggestion: 'Investigate for unnecessary work or algorithmic improvements.',
      references: [],
    }];
  },
}));

const options = { command: ['node', 'app.js'], mode: 'spawn' as const };
const analysis = pipeline.run(bundle, options);
const report = buildLanternaReport(bundle, analysis, [cpuKind], options);
process.stdout.write(serializeReport(report, { pretty: true, kinds: [cpuKind] }));
```

> Each kind closes over its options at construction. `analyzeCapture` and `runCapture` build a fresh pipeline per call — kind-singletons would not service different runs.

### Re-analyzing an existing capture

`@lanterna-profiler/detectors` exposes `analyzeCapture(bundle, options, kinds)` if you only want the default pipeline result for an already-captured bundle:

```ts
import { analyzeCapture } from '@lanterna-profiler/detectors';
import { buildLanternaReport, createCpuProfileKind } from '@lanterna-profiler/core';

const cpuKind = createCpuProfileKind({
  readStderrSoFar: () => '',
  sampleIntervalMicros: 1000,
  deep: false,
});
const options = { command: ['node', 'app.js'], mode: 'spawn' as const };
const analysis = analyzeCapture(bundle, options, [cpuKind]);
const report = buildLanternaReport(bundle, analysis, [cpuKind], options);
```

## Exports at a glance

From `@lanterna-profiler/core`:

- **Orchestration** — `runProfile`, `attachProfile`, `runCapture`.
- **Sources** — `SpawnSource`, `AttachSource`, `ProfileSource`.
- **Kind authoring** — `ProfileKind`, `CaptureProbe`, `KindAnalysisContributor`, `createKindRegistry`, `createCpuProfileKind`, `createMemoryProfileKind`, `createAsyncProfileKind`.
- **Detectors seam** — `KindScopedDetector<K>`, `createFindingAnalyzerFromKindScopedDetector`, `defineFindingAnalyzer`, `defineSectionAnalyzer`, `createAnalysisPipeline`.
- **Report** — `buildLanternaReport`, `serializeReport`, `buildReportSchema`, types (`LanternaReport`, `Finding`, `Hotspot`, `ProfileQuality`, `CaptureBundle`).
- **Noise filters** — `registerNoiseFilter`, `classifyNoiseUrl`, `classifyNoisePackage`, `isNoiseCategory`, `isNoiseRetainerPath`, `shouldKeepNoiseFrames`.

From `@lanterna-profiler/detectors`:

- **Kind factories** — `createCpuProfileKindWithBuiltInDetectors`, `withBuiltInCpuDetectors`, `createMemoryProfileKindWithBuiltInDetectors`, `withBuiltInMemoryDetectors`, `createAsyncProfileKindWithBuiltInDetectors`, `withBuiltInAsyncDetectors`.
- **Pipeline shortcuts** — `analyzeCapture`, `createDefaultAnalysisPipeline`.
- **Detector descriptors** — `defaultDetectors`, `defaultMemoryDetectors`, `defaultAsyncDetectors`, plus per-detector named exports.
- **Analyzer factories** — `createBuiltInFindingAnalyzers`, `createBuiltInMemoryFindingAnalyzers`, `createBuiltInAsyncFindingAnalyzers`.
- **Attribution helpers** — `buildAttributedFinding`, `resolveAttribution`, `buildAttributionEvidence`, `CpuHotspotContext`.
- **Plugin types** — `LanternaDetectorPlugin`, `LanternaPluginContext`.
- **Thresholds** — `DETECTOR_THRESHOLDS` plus threshold types.

## Where to next

- Write a finding detector: [extending/detectors.md](./extending/detectors.md)
- Write a brand-new profile kind: [extending/profile-kinds.md](./extending/profile-kinds.md)
- How plugins are discovered and loaded: [extending/plugin-loading.md](./extending/plugin-loading.md)
- Report shape: [report-schema.md](./report-schema.md)
