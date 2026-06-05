---
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
---

Add an explicit `priorityBasis` to finding measurements so priority ranking reflects the metric the detector actually triggered on. `FindingMeasurements` gains an optional `priorityBasis: { observed, threshold }`, and the priority pipeline now scores a finding by `observed / threshold` from that basis before falling back to the generic measurement heuristics. The built-in async detectors (`long-await`, `deep-async-chain`, `microtask-flood`, `hot-async-context`, `event-loop-blocked-async`) populate it with the metric they fired on (await duration, recursion depth, mean inflight, CPU %, wait time), giving agents a stable, comparable severity signal.
