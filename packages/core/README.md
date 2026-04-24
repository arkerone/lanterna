# @lanterna-profiler/core

Headless capture + analysis primitives for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js profiler.

This package is **TTY-free**: no spinner, no prompts, no process listing. It exposes the building blocks you need to capture profile data, run an analysis pipeline, and build a `LanternaReport`. Bring your own detectors, or install [`@lanterna-profiler/detectors`](../detectors) for the batteries-included pack.

## Install

```bash
npm install @lanterna-profiler/core
```

## What's in the box

- **Capture coordinator** — `runCapture({ source, kinds, ... })` orchestrates one or more probes against a live target and returns a `CaptureBundle`.
- **Sources** — `SpawnSource` / `AttachSource` obtain a CDP connection (`ProfileSource.connect()`); the coordinator drives everything else.
- **Profile kinds** — `ProfileKind`, `CaptureProbe`, `KindAnalysisContributor`, plus the built-in `createCpuProfileKind()` factory.
- **Analysis pipeline** — `createAnalysisPipeline({ kinds, ... })` with `defineFindingAnalyzer` / `defineSectionAnalyzer` to register custom rules.
- **Report** — `buildLanternaReport` + `serializeReport` (zod-validated JSON, schema v2 nests CPU data under `profiles.cpu.*`).
- **Types** — `CaptureBundle`, `LanternaReport`, `Finding`, `Hotspot`, `AnalysisContext`, `FindingAnalyzer`, etc.
- **Runtime hook framework** — `composePreloadScript` / `composeAttachScript` build a single preload from a set of `HookInstaller` fragments (always includes the cross-cutting runtime-signals installer for GC + event-loop lag).

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

let stderr = '';
const cpuKind = createCpuProfileKind({ readStderrSoFar: () => stderr });

const bundle = await runCapture({
  source: new SpawnSource(),
  sourceOptions: {
    command: ['node', 'app.js'],
    sampleIntervalMicros: 1000,
    deep: false,
  },
  kinds: [cpuKind],
  probeOptions: { sampleIntervalMicros: 1000, deep: false },
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
      evidence: { file: top.file, line: top.line, function: top.function, selfPct: top.selfPct, extra: {} },
      why: 'Single function owns >40% of self CPU.',
      suggestion: 'Investigate for unnecessary work or algorithmic improvements.',
      references: [],
    }];
  },
}));

const options = { sampleIntervalMicros: 1000, deep: false, command: ['node', 'app.js'], mode: 'spawn' as const };
const analysis = pipeline.run(bundle, options);
const report = buildLanternaReport(bundle, analysis, ['cpu'], options);
process.stdout.write(serializeReport(report, { pretty: true }));
```

## Adding a new profile kind

Out of the box `core` ships the CPU kind. Future memory/async kinds can be added without touching existing files. See the built-in `kinds/cpu/` implementation for reference and [../../docs/how-lanterna-works.md](../../docs/how-lanterna-works.md) for the architectural overview.

## Related packages

- [`@lanterna-profiler/detectors`](../detectors) — default detector pack + `runProfile` / `attachProfile` facades + `createDefaultKindRegistry()`.
- [`@lanterna-profiler/cli`](../cli) — `lanterna` binary for humans.
