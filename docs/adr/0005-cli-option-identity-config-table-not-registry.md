# ADR 0005: CLI option identity — a config table, not a full registry

Status: Accepted

Date: 2026-06-04

## Context

A profiling option's identity is restated across several CLI modules: the help
descriptor (`option-descriptors.ts`), the Commander registration and per-flag
error messages (`parse.ts`), the parsed/normalized types (`options-policy.ts`),
the provided-flag alias map (`options-normalization.ts`), and the config schema +
normalization + merge-key list (`config.ts`). A review will keep proposing "one
option registry that drives all of them."

The config path is genuinely duplicative and self-contained, so it was collapsed.
The rest is not a clean fit:

- The CLI parsers each throw a `CommanderError` with a flag-specific message
  (`invalid --sample-interval (min 1000)`), so the "parser" is also UX copy.
- `normalizeCommanderError` maps Commander error codes to per-flag guidance.
- Provided-flag tracking has its own key space (`--no-source-maps` → `sourceMaps`,
  `--kind` → `kind` not `kinds`, two heap-snapshot flags → one key).
- Several options are irregularly shaped (the `detectors` / `kinds` array merges,
  the nested `heapSnapshotAnalysis`, the `waitForUrl → waitTimeout` default).

## Decision

The scalar `.lanterna.json` options are driven by one table —
`SCALAR_CONFIG_OPTIONS` in `config.ts` — which pairs each raw field with its
canonical `LanternaConfig` key, its zod schema fragment, and its normalizer, and
drives both `RawConfigSchema` and `normalizeConfig`. Irregular options stay
explicit (the table's escape valve).

The CLI arg parser (`parse.ts`), `PROVIDED_FLAG_ALIASES`, and the
`SCALAR_CONFIG_KEYS` merge list stay as separate, explicit code.

## Consequences

- A new scalar config option is one table row instead of a schema field plus a
  normalize branch.
- The config table stays type-safe (the special fields keep precise types; scalar
  fields are reached only through the table).
- The CLI parsing surface keeps its per-flag error messages and provided-flag
  quirks legible rather than hidden behind a broad option-registry interface.

## Rejected

A single registry that also generates the Commander options, the alias map, and
the error messages. Deriving the zod schema dynamically loses static field types,
and the CLI-only concerns (per-flag messages, provided-flag key quirks) do not
share one clean interface with the config path — the registry would be a table
plus many escape valves, a lateral move at best.
