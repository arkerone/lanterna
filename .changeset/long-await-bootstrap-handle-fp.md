---
"@lanterna-profiler/detectors": patch
---

Fix a `long-await` false-positive present in every async capture.

Node opens an internal `FILEHANDLE` at startup (ESM loader / inspector) that lives ~300ms with `runCount: 0`, `triggerAsyncId: 0`, an empty init stack and no frames — zero JS attribution. The `long-await` detector was reporting it as a low-grade long await anchored on a *guessed* fallback user frame, adding noise to the report on workloads that have no real slow await.

`long-await` now skips such unattributed bootstrap root handles (never ran in JS, no async parent, no frame anywhere). The guard is conservative: a genuine slow await always carries either a trigger ancestry or an init/creation frame, so real I/O and promise awaits are unaffected.
