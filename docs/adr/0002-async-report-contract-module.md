# ADR 0002: Async report contract is a named module

Status: Accepted

Date: 2026-06-04

## Context

The async kind has the widest report shape in Lanterna. Its TypeScript report
type, Zod schema, generated documentation, and profile kind registration all
need to agree.

When these facts live in separate modules without a named contract seam, schema
changes are easy to make locally but hard to validate across consumers.

## Decision

The async kind exposes `packages/core/src/kinds/async/report-contract.ts` as the
named contract module. It re-exports `asyncProfileReportSchema` and provides
`parseAsyncProfileReport(report)`.

The async profile kind uses this contract module for `reportSchema`, and the
core package exports the same contract for programmatic consumers.

The async Zod schema is typed as `z.ZodType<AsyncProfileReport>`, and
`docs/generated/async-profile-report.schema.json` is generated from the same
schema. A test checks that the generated JSON Schema stays in sync.

## Consequences

- Runtime validation, public exports, and docs generation share one seam.
- Programmatic consumers can validate `profiles.async` without assembling a
  full report schema.
- Schema drift is caught by typecheck and by the generated-doc test.
- The full report schema still stays dynamic through `buildReportSchema(kinds)`.

## Rejected

Only document the async shape manually. Manual docs are useful for reading
rules, but they are not a reliable interface for drift-prone nested shapes.
