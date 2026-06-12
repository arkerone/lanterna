---
"@lanterna-profiler/cli": minor
---

CLI hardening (audit follow-up):

- New `--fail-on-target-error` flag on `lanterna run`: exit non-zero when the profiled command exits with a non-zero code (the report is still written first; signal-terminated targets — including Lanterna's own end-of-capture SIGTERM — don't trip it).
- `lanterna run -- npm start` (and other package-manager wrappers) now prints a warning: the wrapper process would be profiled, not the application.
- Capture diagnostics recorded in `meta.captureIntegrity.diagnostics` are now summarized on stderr instead of staying buried in the report.
- A workload that fails to spawn no longer risks crashing the CLI with an unhandled rejection.
