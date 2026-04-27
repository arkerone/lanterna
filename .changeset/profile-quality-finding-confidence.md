---
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
"@lanterna-profiler/cli": minor
---

Add `ProfileQuality` to CPU reports (confidence, sample count, duration basis, idle ratio, reasons, recommendations) and `confidence` + `proofLevel` fields on findings. Built-in detectors populate the new signals and the CLI surfaces them in the `profile` command output.
