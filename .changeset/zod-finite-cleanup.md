---
"@lanterna-profiler/core": patch
---

Drop deprecated `z.number().finite()` chains from the report and runtime-signals schemas. In Zod 4, `z.number()` already rejects `NaN` and `Infinity`, making `.finite()` a no-op. Output schema and validation behavior are unchanged.
