---
"@lanterna-profiler/detectors": patch
---

Stop `excessive-gc` from firing on near-idle processes.

`gcRatio` is GC time divided by **on-CPU** time, so on a mostly-idle process a few milliseconds of startup GC produce a high ratio against a tiny denominator (e.g. 12% from ~3ms of GC). `excessive-gc` now requires a minimum on-CPU presence (`minOnCpuRatio`) before firing on the ratio alone; a genuine long GC pause still fires on its own regardless of how busy the process was.
