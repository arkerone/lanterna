# ADR 0003: Human renderers use a report view

Status: Accepted

Date: 2026-06-04

## Context

The text and Markdown renderers both traversed `LanternaReport` directly. They
duplicated the same display policy: top-N limits, CPU summary deduplication, and
finding user-caller extraction.

That made the renderer modules shallow in the wrong place. Formatting varied by
renderer, but report selection policy should not.

## Decision

Text and Markdown renderers consume `buildReportView(report)` from
`packages/cli/src/renderers/report-view.ts`.

The report view owns display selection policy:

- source-map summary access;
- duplicate suppression for CPU `topRequestEntry`;
- top-N slices for repeated report lists;
- finding `userCaller` and `candidateCallers` extraction.

The renderers remain responsible for formatting text or Markdown only.

## Consequences

- Selection policy has locality in one module.
- Renderer tests and report-view tests exercise the same seam callers use.
- Adding another human renderer should not copy report traversal logic.
- Agent rendering remains separate because it has a different contract and
  stronger decision rules.

## Rejected

Move all rendering into one generic formatter. That would hide too much
format-specific behaviour behind a broad interface and reduce clarity.
