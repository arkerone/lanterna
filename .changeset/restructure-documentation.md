---
'@lanterna-profiler/cli': patch
'@lanterna-profiler/core': patch
'@lanterna-profiler/detectors': patch
---

Restructure documentation: split docs into per-topic and per-kind files (`docs/getting-started.md`, `docs/cli.md`, `docs/configuration.md`, `docs/programmatic-api.md`, `docs/report-schema.md`, `docs/reading-a-report.md`, `docs/signal-quality.md`, `docs/architecture.md`, `docs/troubleshooting.md`, `docs/kinds/{cpu,memory,async}.md`, `docs/extending/{detectors,profile-kinds,plugin-loading}.md`). Root README and package READMEs become concise landing pages pointing to the new structure. Update package descriptions to reflect that Lanterna covers CPU, memory and async profiling. No runtime changes.
