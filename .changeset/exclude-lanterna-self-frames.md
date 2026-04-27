---
'@lanterna-profiler/core': minor
'@lanterna-profiler/detectors': patch
---

Exclude Lanterna's own instrumentation from CPU and memory reports.

Frames that originate from Lanterna's preload script, runtime-signals hooks, or
its `node_modules/@lanterna/*` install paths are now classified under a new
`'lanterna'` `FrameCategory` and dropped from public hotspots, hot allocators,
and heap-snapshot retainer paths. Heap-snapshot retainer chains routed through
`__LANTERNA_*` globals or through the `kObservers` `PerformanceObserver` set are
also filtered, and `growthByConstructor` entries whose retainer paths were all
attributed to Lanterna are pruned via cascade.

Set `LANTERNA_DEBUG_SELF=1` to keep these frames visible when working on
Lanterna itself.
