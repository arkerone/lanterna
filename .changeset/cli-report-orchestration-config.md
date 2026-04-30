---
"@lanterna-profiler/cli": minor
"@lanterna-profiler/core": minor
---

Add a `lanterna report <file>` command to re-render an existing JSON report, plus `--format json|text|markdown` on `run`/`attach`/`report` for terminal- and PR-friendly output. Add run-side orchestration with `--wait-for-url`, `--wait-timeout`, `--capture-delay`, and `--workload` (a shell command run only while the capture is active). Expand `.lanterna.json` to cover duration, output, format, kinds, sample/heap/memory intervals, heap snapshot analysis, and the new readiness/workload options, with CLI flags taking precedence. Core exposes new `beforeCaptureStart` / `onCaptureStarted` capture hooks that power the orchestration.
