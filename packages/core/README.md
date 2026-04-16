# @lanterna/core

Headless capture + analysis primitives for [Lanterna](https://github.com/arkerone/lanterna), the agent-first Node.js CPU profiler.

This package is **TTY-free**: no spinner, no prompts, no process listing. It exposes the building blocks you need to capture a V8 profile, run an analysis pipeline, and build a `LanternaReport`. Bring your own detectors, or install [`@lanterna/detectors`](../detectors) for the batteries-included pack.

## Install

```bash
npm install @lanterna/core
```

## What's in the box

- **Capture** — `startSpawnCapture` / `startAttachCapture` return a `CaptureHandle` that drives the V8 profiler + timed runtime signals (GC, event-loop lag, deopts).
- **Analysis pipeline** — `createAnalysisPipeline` with `defineFindingAnalyzer` / `defineSectionAnalyzer` to register custom rules.
- **Report** — `buildLanternaReport` + `serializeReport` (zod-validated JSON).
- **Types** — `RawCapture`, `LanternaReport`, `Finding`, `Hotspot`, `AnalysisContext`, `FindingAnalyzer`, etc.
- **Runtime hook** — ships the `.cjs` preload hook at `dist/runtime-signals/hooks/event-loop-hook.cjs`.

Default detectors (sync-crypto, blocking-io, excessive-gc, event-loop-stall, …) live in `@lanterna/detectors` so core stays minimal.

## Example — custom detector

```ts
import {
  buildLanternaReport,
  createAnalysisPipeline,
  defineFindingAnalyzer,
  serializeReport,
  startSpawnCapture,
} from '@lanterna/core';

const handle = await startSpawnCapture({
  command: ['node', 'app.js'],
  sampleIntervalMicros: 1000,
  deep: false,
});

await new Promise((r) => setTimeout(r, 15_000));
const raw = await handle.stop();

const pipeline = createAnalysisPipeline();
pipeline.register(defineFindingAnalyzer({
  id: 'my.custom-rule',
  kind: 'finding',
  run(_ctx, snapshot) {
    const top = snapshot.hotspots[0];
    if (!top || top.selfPct < 40) return [];
    return [{
      id: 'my.custom-rule',
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

const analysis = pipeline.run(raw, { sampleIntervalMicros: 1000, deep: false, command: ['node', 'app.js'], mode: 'spawn' });
const report = buildLanternaReport(raw, analysis, { sampleIntervalMicros: 1000, deep: false, command: ['node', 'app.js'], mode: 'spawn' });
process.stdout.write(serializeReport(report, { pretty: true }));
```

## Related packages

- [`@lanterna/detectors`](../detectors) — default detector pack + `runProfile` / `attachProfile` facades.
- [`@lanterna/cli`](../cli) — `lanterna` binary for humans.
