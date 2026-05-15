---
"@lanterna-profiler/cli": patch
---

Remove redundant `sourcemap_applicable` metadata from agent report frontmatter. The agent format now keeps `sourcemap_status` and `sourcemap_coverage`, while structured JSON reports still expose source-map applicability.
