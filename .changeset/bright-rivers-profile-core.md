---
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
"@lanterna-profiler/cli": minor
---

Move profile orchestration into `@lanterna-profiler/core` and narrow `@lanterna-profiler/detectors` to the default CPU detector pack.

- `@lanterna-profiler/core`: expose `runProfile`, `attachProfile`, `createDefaultKindRegistry`, `createDefaultAnalysisPipeline`, and plugin/pipeline orchestration types; split capture coordinator internals and report schema modules while keeping report schema v2 stable.
- `@lanterna-profiler/detectors`: remove `runProfile`, `attachProfile`, and `createDefaultKindRegistry` exports; keep built-in detector analyzers, detector adapters, thresholds, and plugin helper types.
- `@lanterna-profiler/cli`: call profile orchestration from `@lanterna-profiler/core` and use `@lanterna-profiler/detectors` only to register default analyzers.
