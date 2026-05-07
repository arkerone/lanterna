# @lanterna-profiler/detectors

Default detector pack for [Lanterna](https://github.com/arkerone/lanterna) — agent-first Node.js CPU, memory & experimental async profiler.

This package contains the built-in CPU, memory, and async detectors, thresholds, attribution helpers, and kind factories that pre-wire those detectors. Capture orchestration and the `KindScopedDetector` seam itself live in [`@lanterna-profiler/core`](https://www.npmjs.com/package/@lanterna-profiler/core).

## Install

```bash
npm install @lanterna-profiler/core @lanterna-profiler/detectors
```

## Usage

```ts
import { runProfile } from '@lanterna-profiler/core';
import {
  createCpuProfileKindWithBuiltInDetectors,
  createMemoryProfileKindWithBuiltInDetectors,
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
    createMemoryProfileKindWithBuiltInDetectors({}),
  ],
});
```

## Documentation

- [Writing a detector](https://github.com/arkerone/lanterna/blob/main/docs/extending/detectors.md) — plugin contract, `KindScopedDetector`, attribution helpers, full Prisma example.
- [Writing a profile kind](https://github.com/arkerone/lanterna/blob/main/docs/extending/profile-kinds.md) — author a brand-new measurement axis.
- [Loading plugins](https://github.com/arkerone/lanterna/blob/main/docs/extending/plugin-loading.md) — `--detectors` and `.lanterna.json`.
- [Built-in finding catalog](https://github.com/arkerone/lanterna/blob/main/docs/extending/detectors.md#built-in-findings) — every detector grouped by kind.

## Related packages

- [`@lanterna-profiler/core`](https://www.npmjs.com/package/@lanterna-profiler/core) — capture orchestration, profile kinds, pipeline, kind-scoped detector seam, and report APIs.
- [`@lanterna-profiler/cli`](https://www.npmjs.com/package/@lanterna-profiler/cli) — `lanterna` binary built on top of this package.
