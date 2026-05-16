---
"@lanterna-profiler/cli": minor
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
---

Improve hotspot attribution diagnostics and agent report readability.

Lanterna now preserves anonymous user-code wrapper frames as actionable attribution clues, carries richer user-caller evidence through memory, async, GC, and CPU findings, and clarifies internal hotspot attribution naming without changing the public CLI contract.
