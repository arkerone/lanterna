---
"@lanterna-profiler/core": patch
"@lanterna-profiler/cli": patch
"@lanterna-profiler/detectors": patch
---

Improve attach capture lifecycle reliability and progress reporting.

- `@lanterna-profiler/core`: add a guarded internal capture session so CDP connections are closed and sources are finalized on post-connect failures; expose structured non-fatal capture diagnostics under `meta.captureIntegrity.diagnostics`; add attach runtime-hook, inspector discovery, and PID metadata timeouts with CDP cleanup when targets do not answer; remove temporary spawn preload files on startup failures; clear termination wait timers while rereading real child exit state; and emit `start-capture`, `capture-running`, and `finalize-capture` progress from real capture checkpoints rather than display timing.
- `@lanterna-profiler/cli`: share run/attach command execution through a common profile-command helper, remove command-level `process.exit(0)`, and handle interactive attach cancellation through `main` with `process.exitCode`.
- `@lanterna-profiler/detectors`: expose a grouped `extensionApi` surface; forward capture lifecycle progress without delayed duplicate finalization updates; and add extension-contract coverage for duplicate kind, section analyzer, and finding analyzer registrations plus non-fatal analyzer diagnostics.
