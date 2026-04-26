---
'@lanterna-profiler/core': minor
'@lanterna-profiler/detectors': minor
'@lanterna-profiler/cli': minor
---

## Add `memory` profile kind

Adds a new `memory` profile kind alongside the existing `cpu` kind.

- Drives the V8 sampling heap profiler (`HeapProfiler.startSampling` /
  `stopSampling`) and emits a `profiles.memory.{summary,hotAllocators,memoryUsage}`
  section in the Lanterna report.
- Samples `process.memoryUsage()` at a fixed cadence via a preload hook to
  produce a continuous RSS / heapUsed / external / arrayBuffers time series.
- Ships four built-in memory detectors: `memory-growth`, `large-allocator`,
  `external-buffer-pressure`, and the cross-kind `alloc-in-hot-path`.
- Opt-in via `--kind memory` (or `--kind cpu memory`); the default capture
  remains `cpu` only.
