# @lanterna-profiler/core

Headless capture + analysis primitives for [Lanterna](https://github.com/arkerone/lanterna) — agent-first Node.js CPU, memory & experimental async profiler.

This package is **TTY-free**: no spinner, no prompts, no process listing. It exposes the orchestration APIs you need to capture profile data, run an analysis pipeline, and build a `LanternaReport`. Bring your own analyzers, or install [`@lanterna-profiler/detectors`](https://www.npmjs.com/package/@lanterna-profiler/detectors) for the default detector pack.

## Install

```bash
npm install @lanterna-profiler/core
# Add the default detector pack if you want built-in CPU/memory/async findings
npm install @lanterna-profiler/detectors
```

## Usage

```ts
import { runProfile } from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

const report = await runProfile({
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
});
```

## Documentation

- [Programmatic API](https://github.com/arkerone/lanterna/blob/main/docs/programmatic-api.md) — `runProfile`, `attachProfile`, low-level `runCapture` + pipeline.
- [Report schema](https://github.com/arkerone/lanterna/blob/main/docs/report-schema.md) — `LanternaReport` (schema v2).
- [Architecture](https://github.com/arkerone/lanterna/blob/main/docs/architecture.md) — capture flow, modes, enrichment.
- [Writing a profile kind](https://github.com/arkerone/lanterna/blob/main/docs/extending/profile-kinds.md).
- [Writing a detector](https://github.com/arkerone/lanterna/blob/main/docs/extending/detectors.md).

## Related packages

- [`@lanterna-profiler/cli`](https://www.npmjs.com/package/@lanterna-profiler/cli) — `lanterna` binary built on top of this package.
- [`@lanterna-profiler/detectors`](https://www.npmjs.com/package/@lanterna-profiler/detectors) — default detector pack and plugin helpers.
