---
"@lanterna-profiler/cli": minor
"@lanterna-profiler/detectors": patch
---

Rewrite the agent report format around YAML frontmatter, a `## Findings` table with a `decision` column, and per-kind review tables so agents can analyze a profile end-to-end without falling back to raw JSON. Source-mapped locations and user-caller attribution are surfaced uniformly across CPU, memory, and async kinds.

Improve async detector evidence so agent reports can surface user-code attribution for long async operations.
