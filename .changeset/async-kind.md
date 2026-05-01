---
"@lanterna-profiler/cli": minor
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
---

Add a third profile kind `async` (experimental and combinable with `cpu` and `memory` via `--kind`). It enables `Debugger.setAsyncCallStackDepth` over CDP and an `async_hooks` aggregator in the preload, producing a `profiles.async` section with per-resource records, async chain trees, concurrency timeline, quality metadata, and integrity counters.

Five new detectors ship with it: `long-await`, `orphan-async-resource`, `deep-async-chain`, `microtask-flood`, and `hot-async-context`. New CLI options: `--async-max-events`, `--async-concurrency-interval`, `--async-stack-depth`, `--async-include-microtasks`, and `--async-instrumentation <off|safe|full>`.

Async attach cleanup now tears down hooks and samplers, restores patched APIs, clears retained in-target state after reads, and allows a later async attach to reinstall hooks in the same target process. The CLI and docs mark `async` as experimental and warn that attach mode is partial because preexisting resources and already-loaded code cannot be fully observed.
