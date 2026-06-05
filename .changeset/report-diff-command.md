---
"@lanterna-profiler/cli": minor
---

Add `lanterna diff <baseline.json> <current.json>` to compare two reports. It diffs findings by id (added / removed / changed / unchanged) plus headline CPU and memory metric deltas, and exposes a `regressed` headline (true when the current report introduces or worsens a non-info finding) for agents and CI gates. Supports `--format text|markdown|agent|json`. See `docs/diffing-reports.md`.
