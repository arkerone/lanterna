---
"@lanterna-profiler/core": patch
"@lanterna-profiler/detectors": patch
"@lanterna-profiler/cli": patch
---

Improve CPU hot-path diagnostics for synchronous crypto findings. Source map integrity now distinguishes non-applicable plain JavaScript from failed source-map resolution, CPU attribution exposes user caller candidates with stack distance, event-loop stall evidence reports heartbeat sample coverage, and CLI report formats surface the new reliability signals.
