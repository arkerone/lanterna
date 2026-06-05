# ADR 0006: independent package versioning

Status: Accepted

Date: 2026-06-05

## Context

The three published packages are at different major versions: `@lanterna-profiler/core`
and `@lanterna-profiler/detectors` are on `2.x`, while `@lanterna-profiler/cli` is on
`1.x`. Changesets is configured with `updateInternalDependencies: patch`, so a `core`
change ripples a patch bump into `detectors` and `cli`. Contributors keep asking whether
the versions should be unified (a fixed/locked version group) and why the CLI lags a major
behind the libraries.

The packages have genuinely different audiences and stability contracts:

- `core` and `detectors` are **programmatic APIs**. Their consumers import types, the
  report schema, `defineProfileKind`, detector helpers, and thresholds. A breaking change
  is a TypeScript/API break, governed by the report schema version and the public exports.
- `cli` is a **command surface**. Its consumers are humans and agents invoking `lanterna
  run/attach/report`. A breaking change is a removed/renamed flag, a changed default, or a
  changed renderer contract — not necessarily an API break.

These two break independently. The async report contract (a library concern) can change
without touching any CLI flag, and a flag can be renamed without changing a single exported
type.

## Decision

Keep the packages **independently versioned** via Changesets. Do not lock them into a fixed
version group.

- Version each package against *its own* public contract: `core`/`detectors` against their
  exports + report schema; `cli` against its flags, defaults, and renderer output.
- Let `updateInternalDependencies: patch` carry internal dependency bumps. A `core` major
  does **not** force a `cli` major unless the CLI's own surface breaks.
- The **report schema version** (`LANTERNA_REPORT_SCHEMA_VERSION`), not any package's semver,
  is the contract for report consumers. Schema changes are called out in
  `docs/report-schema.md` regardless of which package version moved.

## Consequences

- Version numbers will continue to diverge across packages, and that is expected — it is not
  drift to "fix".
- A changeset author chooses the bump per package based on which contract changed. Adding a
  flag is a `cli` minor; changing the async section shape is a `core` minor (and a schema
  version concern); renaming an exported type is a `core` major.
- Report consumers pin behavior to the schema version, so they are insulated from package
  number divergence.

## Rejected

A fixed/locked version group that bumps all three together. It would inflate the CLI to a
major it did not earn every time a library type changed, and it would tell agents that a
CLI flag changed when only an internal type moved — exactly the false signal independent
versioning avoids.
