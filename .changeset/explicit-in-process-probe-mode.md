---
"@lanterna-profiler/core": patch
---

Propagate the real source mode to probes instead of inferring it. `ConnectedSource` now carries an explicit `mode: 'spawn' | 'attach' | 'in-process'` that each source sets, and the coordinator forwards it verbatim to every probe lifecycle step (`ProbeLifecycleContext.mode` gains `'in-process'`). This fixes in-process capture being mislabeled: the async probe now marks `attachPartialCapture` for both `attach` and `in-process` (runtime hooks installed after startup can only observe resources created afterwards), and the async-quality reason was reworded to describe late hook installation rather than attach specifically.
