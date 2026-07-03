---
"@lanterna-profiler/core": minor
---

Close the remaining "never miss profiling data" gaps and reduce in-target capture overhead:

- **New: periodic mid-capture drain (attach/in-process).** Previously the in-target event-loop, GC, memory-usage, and async_hooks buffers were read exactly once, at stop — a target that exited or hung mid-capture lost everything observed since the start. The coordinator now drains those buffers every ~10s while an attach/in-process capture runs (spawn is unaffected — it already streams live over the control channel), bounding worst-case loss to roughly one drain interval and keeping the in-target buffer caps practically unreachable.
- **Buffer-overflow counters are no longer silent.** New optional `meta.captureIntegrity.eventLoopSamplesDropped` / `gcEventsDropped` / `memoryUsageSamplesDropped` record when the always-on in-target buffers evicted samples (drop-oldest) before Lanterna could read them. `mergeCaptureIntegrityCounters` now takes the max per counter across channels instead of letting a staler read overwrite a fresher one.
- **`crash` events are no longer dropped.** The in-target hook already emitted a `crash` control event on an uncaught exception; it was absent from the control-channel schema, so `safeParse` silently rejected it. It now reaches the report as optional `meta.targetCrash: { kind, message }` (spawn mode).
- **Read timeouts leave a trace.** A CDP read that times out during finalization (event-loop, GC, or runtime-integrity) now records a `runtime-read` diagnostic in `meta.captureIntegrity.diagnostics` instead of silently returning empty data.
- **New async truncation counters.** `profiles.async.quality` gains four optional fields — `pendingAwaitStacksDropped`, `runWindowsDropped`, `concurrencySamplesDropped`, `cdpAsyncContextsDropped` — surfacing finer-grained data loss than `recordsDropped` alone, each backed by a matching in-target/profiler-side cap (previously unbounded or silently truncated).
- **Lower in-target overhead.** Control-channel writes (heartbeats, GC events, memory samples) are now batched into one `fs.writeSync` per ~50ms window (or every 64 events) instead of one write per event; lifecycle events (`hook-ready`, `capture-start`, `app-complete`, `crash`) still flush immediately. The async_hooks `init` hot path drops a redundant map lookup and memoizes the per-file noise-frame test.
- All new fields are additive and optional — existing consumers are unaffected.
