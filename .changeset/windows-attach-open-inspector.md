---
"@lanterna-profiler/core": minor
---

`attach --pid` now finds an already-open inspector on Windows. The cross-platform HTTP scan for an existing inspector endpoint runs before the POSIX-only `SIGUSR1` fallback, so on Windows `lanterna attach --pid <pid>` works when the target was started with `--inspect`. When no inspector is open, it now fails with a Windows-specific message pointing at `--inspect`/`--inspect-url` instead of an unconditional "not supported".
