# ADR 0004: Detector finding helpers stay per-kind

Status: Accepted

Date: 2026-06-04

## Context

The CPU detector pack has a deep `defineAttributedHotspotDetector` factory and a
shared `assembleAttributedFinding` spine ([CONTEXT.md], ADR-0001). A natural
follow-up is "do the same for memory and async, and unify the cross-kind evidence
helpers." An architecture review will keep surfacing this because the three
families *look* parallel.

On inspection they are not parallel enough to share one deep module:

- **Memory detectors.** Only `large-allocator` has the "rank a list → cap → dedup
  → assemble" shape. `alloc-in-hot-path` is a cross-kind correlation with a
  fallback, `external-buffer-pressure` derives a single finding from series
  stats, and `memory-growth` iterates two fixed metrics. One ranked-list adapter
  is a hypothetical seam, not a real one.

- **Cross-kind evidence helpers.** `resolveAttribution` (cpu) is a *lookup* into
  the pre-built `userCallerById` / `candidateCallersById` maps returning a
  `UserCallerAttribution` with confidence tiers; `resolveAsyncUserCaller` (async)
  *constructs* a `UserCallerAttribution` from a frame plus options;
  `correlatedAllocatorFromMemory` (memory) *selects* a `CorrelatedAllocatorEvidence`
  — a different type — by editability rules. Different inputs, different output
  types, different algorithms.

## Decision

Detector finding helpers are deepened **per kind**, only where two or more
adapters justify a seam:

- The four ranked-list async detectors (`long-await`, `deep-async-chain`,
  `event-loop-blocked-async`, `hot-async-context`) share
  `collectAsyncListFindings` — the capped iterate → skip/stop → `buildAsyncFinding`
  loop. The two single-finding async detectors stay bespoke.
- Memory keeps `buildMemoryFinding` as an assembly shell with no surrounding
  factory: there is only one ranked-list memory detector.
- The cpu / async / memory evidence helpers stay separate modules. No unified
  `resolveEvidenceFrame` seam.

## Consequences

- New ranked-list async detectors inherit the cap and skip/stop semantics from
  one place; everything else stays where its complexity lives.
- A future review that re-proposes a memory detector factory or a unified
  evidence resolver should weigh it against this ADR first.

## Rejected

A unified `resolveEvidenceFrame(entity, fallback, context)` across kinds. It fails
the deletion test: deleting it leaves each kind's real logic (map lookup, frame
construction, allocator selection) exactly in place — the wrapper would dispatch,
not concentrate, so it would be a shallow seam over three different operations.

[CONTEXT.md]: ../../CONTEXT.md
