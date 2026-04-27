---
'@lanterna-profiler/core': minor
'@lanterna-profiler/detectors': patch
---

Exclude Lanterna's own instrumentation from CPU and memory reports, and expose a registry so future profile kinds can declare their own self-noise.

**What changes in reports**

- New `'lanterna'` value in the `FrameCategory` enum (added to the report schema).
- Frames originating from the spawn-injected preload tmpfile, any source under `runtime-signals/hooks/`, or `node_modules/@lanterna/*` / `node_modules/@lanterna-profiler/*` are tagged `lanterna` and dropped from `profiles.cpu.hotspots`, `profiles.cpu.hotStacks`, and `profiles.memory.hotAllocators`.
- `profiles.cpu.summary` ratios subtract Lanterna samples from the denominator so they describe the profiled application, not the profiler.
- Heap-snapshot retainer paths are filtered when they route through `__LANTERNA_*` globals or through `node:perf_hooks`' internal `kObservers` Set (the `PerformanceObserver` registered by the event-loop hook). `growthByConstructor` entries whose retainer paths were all attributed to a noise source are cascade-pruned.
- Set `LANTERNA_DEBUG_SELF=1` to disable every filter at once when working on Lanterna itself.

**New public API (`@lanterna-profiler/core`)**

`registerNoiseFilter`, `getRegisteredNoiseFilters`, `classifyNoiseUrl`, `classifyNoisePackage`, `isNoiseCategory`, `isNoiseRetainerPath`, `shouldKeepNoiseFrames`, plus the `NoiseFilter` and `NoiseUrlMatch` types. The bundled Lanterna filter is auto-registered; a future profile kind that injects JS into the target can call `registerNoiseFilter({...})` to declare its own preload, hooks, and retainer signatures without touching the analyzers.

**Detectors**

Defense in depth: `aggregateByPatterns` now skips noise categories unconditionally even if a caller passes a permissive `categories` list.
