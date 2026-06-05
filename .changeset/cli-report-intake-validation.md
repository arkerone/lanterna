---
"@lanterna-profiler/cli": minor
---

Validate report JSON on intake for `lanterna report` and `lanterna diff`. A new `readLanternaReport` helper parses the file, validates it against the report schema, and checks the schema version, replacing the bare `JSON.parse(...) as LanternaReport` casts. Malformed JSON, reports that don't match the schema, or reports from an unsupported schema version now fail with a clear, labeled error (e.g. which file and which field) instead of surfacing as confusing downstream crashes.
