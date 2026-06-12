---
"@lanterna-profiler/core": minor
---

Harden the capture lifecycle and the in-target hook footprint (audit follow-up):

- **In-target safety nets:** the hook framework's heartbeat and GC buffers are now capped (drop-oldest), and a liveness watchdog auto-disposes the injected hooks when the profiler's periodic keepalive pings stop for ~2.5 minutes — an abandoned attach session no longer leaks instrumentation (or heap) inside the target process forever.
- **SIGUSR1 guard:** attach-by-pid refuses to signal a pid whose executable does not look like a Node.js runtime (SIGUSR1's default disposition terminates such processes). When the platform offers no way to verify, the previous behavior is preserved.
- **Fail-fast captures:** a capture where *every* probe fails to install/start now fails with the probe diagnostics instead of producing an empty "successful" report; `readRuntimeClockNow` failures now throw instead of silently zeroing the capture clock (which dropped all timed signals in attach mode); `Runtime.evaluate` exceptions in the target are surfaced instead of becoming silent `undefined`.
- **Spawn fixes:** the default (cpu-only) run no longer pays a fixed 500ms `Debugger.paused` race at startup; the preload restores the parent `NODE_OPTIONS` once loaded so descendant Node processes don't inherit `--inspect-brk` and the preload; the preload path is quoted in `NODE_OPTIONS` (temp paths with spaces); the hook no longer listens to `unhandledRejection` (the listener silently disabled Node's default crash semantics in the profiled app); the FD3 control channel handles stream errors instead of crashing the profiler.
- **Accuracy:** `durationMs` is frozen before probes stop, so a slow final heap snapshot no longer inflates rate thresholds and impact estimates; second `SIGINT`/`SIGTERM` during finalization now force-terminates instead of being swallowed; unpaired observed measurement values are clamped when computing finding priority so plugin findings can't drown curated ones; dual-stack inspector discovery dedupes by target id.
- **New report fields:** `meta.targetExitCode` / `meta.targetExitSignal` (optional, spawn mode) record how the target exited when it exited during the capture.
