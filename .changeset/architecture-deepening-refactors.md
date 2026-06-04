---
"@lanterna-profiler/core": patch
"@lanterna-profiler/detectors": patch
"@lanterna-profiler/cli": patch
---

Architecture deepening across the three packages — internal refactors with no
change to emitted reports or findings (full suites, including the example e2e,
pass unchanged).

- **detectors.** The five attributed-hotspot CPU detectors share one spine and
  factory (`assembleAttributedFinding` / `defineAttributedHotspotDetector`); the
  four ranked-list async detectors (`long-await`, `deep-async-chain`,
  `event-loop-blocked-async`, `hot-async-context`) share `collectAsyncListFindings`
  — the capped iterate → skip/stop → `buildAsyncFinding` loop. Single-finding and
  non-hotspot detectors stay bespoke.
- **core.** The probe install → start → stop → dispose lifecycle moves into
  `ProbeOrchestrator`, so the coordinator drives three methods instead of threading
  a six-value bag through eight functions. The three drifted `withTimeout` copies
  collapse into `shared/timeout.ts` (`withTimeout` / `withTimeoutResult` /
  `withTimeoutOrThrow`).
- **cli.** The scalar `.lanterna.json` options are driven by one
  `SCALAR_CONFIG_OPTIONS` table that feeds both `RawConfigSchema` and
  `normalizeConfig`.

The boundaries deliberately left uncrossed (no memory detector factory, no unified
cross-kind evidence seam, no full CLI option registry) are recorded in
`docs/adr/0004` and `docs/adr/0005`.
