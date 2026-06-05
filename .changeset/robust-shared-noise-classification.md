---
"@lanterna-profiler/core": minor
"@lanterna-profiler/cli": patch
---

Harden self-noise classification and apply it uniformly across every kind. `classifyNoiseUrl` now normalizes its input internally (strips the `file://` scheme, folds Windows separators), so a raw V8 frame url is classified the same way a pre-normalized path is — previously each caller (the CPU/memory frame classifier, the async kind, the CLI renderer) re-derived the path shape slightly differently, and the CLI path check missed `file://` urls entirely. Two helpers are exported for reuse: `isNoiseUrl(url)` and `normalizeNoiseUrl(url)`.

The async kind now routes every representative-frame pick (creation frame, hot-file aggregation key, CPU-attribution root and execution frames, user caller) through a single `firstUserFrame` helper backed by this shared registry, so Lanterna's own instrumentation can no longer surface as the origin of an async operation through any path. CPU and memory already classified frames through the registry; this brings async to parity.
