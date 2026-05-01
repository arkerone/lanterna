---
"@lanterna-profiler/cli": minor
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
---

Add a third profile kind `async` (combinable with `cpu` and `memory` via `--kind`). It enables `Debugger.setAsyncCallStackDepth` over CDP and an `async_hooks` aggregator in the preload, producing a `profiles.async` section with per-resource records, async chain trees, concurrency timeline, and integrity counters. Five new detectors ship with it: `long-await`, `orphan-async-resource`, `deep-async-chain`, `microtask-flood`, and `hot-async-context`. New CLI options: `--async-max-records`, `--async-concurrency-interval`, `--async-stack-depth`, `--async-include-microtasks`, `--async-instrumentation-mode`.
