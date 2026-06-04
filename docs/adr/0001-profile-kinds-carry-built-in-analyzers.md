# ADR 0001: Profile kinds carry built-in analyzers

Status: Accepted

Date: 2026-06-04

## Context

Lanterna has three built-in profile kinds: CPU, memory, and async. Each kind can
ship findings that only make sense when that kind is selected. The old detector
pipeline had CPU-specific defaults and required callers to remember which
analyzers to add beside the selected kinds.

That made the analyzer seam shallow: callers selected kinds in one place and
had to recreate the detector policy in another place.

## Decision

Built-in detector packages attach their default analyzers to the
`ProfileKind.builtInAnalyzers` interface. The detectors package exposes wrappers
such as `withBuiltInCpuDetectors`, `withBuiltInMemoryDetectors`, and
`withBuiltInAsyncDetectors`.

`@lanterna-profiler/detectors` also owns `collectBuiltInAnalyzers(kinds)`, which
preserves analyzers already carried by a kind and falls back to the built-in
detector set for known built-in kind ids.

## Consequences

- The selected kind is now the source of truth for its built-in analyzers.
- CLI and programmatic callers do not need a separate kind-id switch to install
  CPU, memory, or async detectors.
- Third-party kinds can use the same interface without changing the detector
  pipeline.
- Fallbacks for known built-in ids stay in the detectors package for backwards
  compatibility, not in core.

## Rejected

Keep a central detector switch in the CLI or analysis shortcut. That would keep
the interface shallow and force every caller to mirror the same policy.
