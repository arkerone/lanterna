# @lanterna-profiler/core

Headless capture + analysis primitives for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js profiler.

This package is **TTY-free**: no spinner, no prompts, no process listing. It exposes the orchestration APIs you need to capture profile data, run an analysis pipeline, and build a `LanternaReport`. Bring your own analyzers, or install [`@lanterna-profiler/detectors`](../detectors) for the default detector pack.

## Install

```bash
npm install @lanterna-profiler/core
```

## What's in the box

- **Capture coordinator** — `runCapture({ source, kinds, ... })` orchestrates one or more probes against a live target and returns a `CaptureBundle`. Each kind closes over its own probe options at construction time — there is no global `probeOptions`.
- **Profile orchestration** — `runProfile(...)` and `attachProfile(...)` run capture, analysis, and report construction without CLI UI. Both accept `extraAnalyzers` and `setupPipeline` for extensibility.
- **Sources** — `SpawnSource` / `AttachSource` obtain a CDP connection (`ProfileSource.connect()`); the coordinator drives everything else.
- **Profile kinds** — `ProfileKind` (with optional `contributeMeta` / `contributeIntegrity` / `builtInAnalyzers` / `reportSchema`), `CaptureProbe`, `KindAnalysisContributor`, plus the built-in `createCpuProfileKind()` factory.
- **Kind registry** — `createKindRegistry([...])` resolves CLI `--kind <id>` strings.
- **Kind-scoped detectors** — `KindScopedDetector<K>` + `createFindingAnalyzerFromKindScopedDetector(detector)` for typed multi-kind detectors.
- **Analysis pipeline** — `createAnalysisPipeline({ kinds, ... })` with `defineFindingAnalyzer` / `defineSectionAnalyzer` to register custom rules.
- **Report** — `buildLanternaReport(bundle, analysis, kinds, options)` + `serializeReport(report, { pretty, kinds })` + `buildReportSchema(kinds)` (Zod schema is composed dynamically from the active kinds — schema v2 nests CPU data under `profiles.cpu.*` and per-kind meta under `meta.kinds.<id>.*`).
- **Types** — `CaptureBundle`, `LanternaReport`, `Finding`, `ProfileQuality`, `Hotspot`, `AnalysisContext`, `FindingAnalyzer`, etc.
- **Runtime hook framework** — active kinds can contribute hook fragments through `ProfileKind.hookInstaller`; the capture coordinator composes them with the cross-cutting runtime-signals installer for GC + event-loop lag.

Default detectors (sync-crypto, blocking-io, excessive-gc, event-loop-stall, …) live in `@lanterna-profiler/detectors` so core stays minimal.

## Example — custom detector

```ts
import {
  buildLanternaReport,
  createAnalysisPipeline,
  createCpuProfileKind,
  defineFindingAnalyzer,
  runCapture,
  serializeReport,
  SpawnSource,
} from '@lanterna-profiler/core';

const cpuKind = createCpuProfileKind({
  readStderrSoFar: () => '',
  sampleIntervalMicros: 1000,
  deep: false,
});

const bundle = await runCapture({
  source: new SpawnSource(),
  sourceOptions: {
    command: ['node', 'app.js'],
  },
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

## Adding a new profile kind

Out of the box `core` ships the CPU and memory kinds. Future async or domain-specific kinds can be added without touching existing files. See the built-in `kinds/cpu/` and `kinds/memory/` implementations for reference and [../../docs/how-lanterna-works.md](../../docs/how-lanterna-works.md) for the architectural overview.

## Related packages

- [`@lanterna-profiler/detectors`](../detectors) — default detector pack, analyzer adapters, thresholds, and plugin helper types.
- [`@lanterna-profiler/cli`](../cli) — `lanterna` binary for humans.
