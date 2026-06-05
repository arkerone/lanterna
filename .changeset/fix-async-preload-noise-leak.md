---
"@lanterna-profiler/core": patch
"@lanterna-profiler/cli": patch
---

Stop surfacing Lanterna's own injected preload (`/tmp/lanterna-preload-*.cjs`) as user code in async reports. The preload could sit on an async resource's init stack and was being reported as a high-confidence `user_caller` in `top_operations`/`cpuAttribution` and as a `read-first` entry in **Files To Read First**, pointing investigations at the profiler instead of the app.

The async analysis now refuses to attribute a long await or CPU window to a Lanterna instrumentation frame, and picks the first non-instrumentation frame as the representative origin. The agent renderer additionally excludes the preload path from editable user files as defense-in-depth.
