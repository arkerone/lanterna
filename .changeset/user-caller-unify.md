---
'@lanterna-profiler/core': major
'@lanterna-profiler/detectors': major
'@lanterna-profiler/cli': minor
---

Unify user-code attribution under `UserCallerAttribution` and broaden coverage.

- New `userCaller?: UserCallerAttribution` exposed on `MemorySummary.topAllocator` and `AsyncSummary.topAsyncHotFile` (already on `Hotspot`, `MemoryHotAllocator`, `AsyncTopOperation`, `AsyncCpuAttributionEntry`, `AsyncHotFile`).
- **Breaking** (core, detectors): `findings[].evidence.extra.userAttribution` (shape `HotspotAttributionEvidence`) replaced by `findings[].evidence.extra.userCaller` (shape `UserCallerAttribution`). Field `samplePct` becomes `profilePct`; `basis` is added (`cpu-sample-path`); `confidence` is widened to `'low' | 'medium' | 'high'`.
- **Breaking** (core): `HotspotAttributionEvidence` and the `HotspotAttribution` type export are removed. The internal map `CpuAnalysisView.hotspotAnalysis.userAttributionById` is renamed to `userCallerById` and now stores `UserCallerAttribution`.
- CLI text and markdown renderers now render the async profile (top operations, hot files, CPU attribution) and surface `userCaller` everywhere it appears.
