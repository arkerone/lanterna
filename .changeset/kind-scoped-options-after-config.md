---
"@lanterna-profiler/cli": patch
---

Validate kind-scoped options after the `.lanterna.json` config is merged instead of at parse time. Previously `--async-*` and `--heap-snapshot-*` flags were rejected during arg parsing whenever the matching kind was missing, so a kind supplied only through config (e.g. `"kinds": ["async"]`) would still be falsely rejected. The check now runs in `validateKindScopedOptions` once flags and config kinds are merged, and the standalone heap-snapshot config assertion was folded into the same place. Config-provided async/heap-snapshot options are now validated too, with their own messages.
