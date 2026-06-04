# Testing And Coverage

Lanterna uses layered verification because a profiler has both pure analysis code and real process-instrumentation paths.

## Test Layers

- Unit and model tests cover report schemas, detector thresholds, attribution, source maps, async analysis, memory analysis, and renderer contracts.
- Live CLI tests exercise real spawn/attach flows against small Node programs.
- Example E2E tests run documented workloads through the locally built CLI, including positive findings, fixed negative variants, attach mode, and agent output.
- `test:e2e:smoke` runs a representative CPU, memory, and async subset plus attach and agent checks for PR/release gates.
- The scheduled/manual E2E workflow runs the full example suite.

## Coverage Gate

`npm run test:coverage` enforces global thresholds:

| Metric | Threshold |
| --- | ---: |
| Statements | 70% |
| Branches | 60% |
| Functions | 70% |
| Lines | 70% |

These thresholds are intentionally modest. They catch broad regressions without pretending that coverage tooling fully observes code injected into target processes.

## Known Low-Coverage Hotspots

The following areas are critical to capture reliability and need explicit attention when they change:

| Area | Why coverage is low | Required evidence when changed |
| --- | --- | --- |
| `core/src/inspector/client.ts` | Real CDP behavior is mostly exercised through live tests rather than isolated unit tests. | Add a focused fake-CDP unit test or extend a live attach/spawn test. |
| `core/src/runtime-signals/hooks/**` | Hook source is serialized and evaluated inside the target process; V8 coverage for the host test runner does not see most executed target code. | Add live tests asserting emitted integrity, cleanup, and degradation fields, or document a deliberate exclusion. |
| `core/src/kinds/*/probe.ts` | Probe lifecycles depend on CDP domains and target timing. | Add lifecycle tests with a fake CDP client for failure paths, plus live checks for successful captures. |
| `core/src/capture/**` | Shutdown, timeout, signal, and process-management paths are hard to hit deterministically. | Add targeted timeout/signal tests or E2E coverage with retained failure artifacts. |

## Rules For Future Changes

- Do not exclude a low-coverage file just to raise the percentage.
- If code is excluded because it is injected into a target, add a note in this document naming the live/E2E test that covers it.
- Any new profile kind should ship at least one unit test for analysis, one schema test for its report section, and one live or E2E capture path.
- Any new built-in detector must be added to `examples/manifest.mjs`; the normal test suite enforces this through `examples.coverage.test.ts`.

## Commands

```bash
npm test
npm run test:coverage
npm run test:e2e:smoke
npm run test:e2e
```
