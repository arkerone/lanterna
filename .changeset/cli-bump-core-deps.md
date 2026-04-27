---
"@lanterna-profiler/cli": patch
---

Align CLI dependency ranges with `@lanterna-profiler/core` `^1.4.0` and `@lanterna-profiler/detectors` `^1.3.1`. This pulls in the noise-filter registry (Lanterna's own instrumentation is now excluded from CPU and memory reports, with a public API for future profile kinds to declare their own self-noise) for users installing the CLI fresh from npm.
