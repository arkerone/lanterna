---
"@lanterna-profiler/core": minor
---

Add `profileInProcess()` — in-process self-profiling. A long-running service (or an embedded agent) can now profile its **own** process via an in-process `node:inspector` session, with no child spawn and no remote attach. It reuses the entire enrichment pipeline, sets `meta.mode = 'in-process'`, and is driven by `durationMs` or an `AbortSignal` since the host does not exit during capture. New exports: `profileInProcess`, `InProcessProfileOptions`, `InProcessProgressEvent`, and the `ProfileMode` type.
