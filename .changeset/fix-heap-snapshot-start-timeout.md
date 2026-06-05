---
"@lanterna-profiler/core": minor
"@lanterna-profiler/cli": patch
---

Fix `--heap-snapshot-analysis` always timing out on the start snapshot in spawn mode. The start heap snapshot was taken during `probe.start()`, while the target was still suspended at `--inspect-brk`, so `HeapProfiler.takeHeapSnapshot` could never complete and always hit the 30s capture timeout — leaving retention analysis permanently `unavailable` and forcing `rerun_required: true`.

Probes now expose an optional `afterRuntimeReleased` lifecycle hook that runs after the coordinator resumes the runtime (and is a no-op in attach mode, where the target was never suspended). The memory probe takes its start snapshot there, so start/end retainer-path comparison works end-to-end. CPU sampling still starts before the runtime is released, preserving startup-cost capture.

The agent renderer also no longer treats the informational "heap snapshot analysis truncated to top N constructor groups" note as a degrading caveat, so a successful retention analysis is no longer mislabeled `rerun_required`.
