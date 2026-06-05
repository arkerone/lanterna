---
"@lanterna-profiler/detectors": minor
---

Add a centralized detector reliability tier. `@lanterna-profiler/detectors` now exports `BEST_EFFORT_DETECTOR_IDS`, `detectorReliabilityTier(findingId)`, `isBestEffortFinding(findingId)`, `findingBaseId(findingId)`, and the `DetectorReliabilityTier` type — the single source of truth for which built-in detectors are probabilistic (best-effort) versus standard. The CLI agent renderer now consumes this instead of a hardcoded list, so the classification no longer drifts between the renderer, the docs, and the example manifest.
