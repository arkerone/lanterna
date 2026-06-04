---
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": minor
---

Stop `deep-async-chain` from firing on long sequential `await` loops and fan-outs.

A `while { await … }` loop — queue consumer, poller, any sequential pipeline —
chains each iteration's resource onto the previous one through `triggerAsyncId`,
so the structural trigger-tree depth grows to the iteration count (1000s) even
though nothing is nested. `deep-async-chain` gated on that structural depth and
reported a bogus `critical` for an extremely common production pattern.

async_hooks cannot encode await-*nesting* as a live trigger chain (it stays ~3
for a sequential loop, a deep recursion, and a wide `Promise.all` alike), so the
structural `depth` is meaningless as a nesting signal. The real signal is
recursion in the **creation stack**: async chains now carry **`recursionDepth`**,
the most times a single user function repeats in a resource's init stack (capped
by `--async-stack-depth`). Recursion-through-promises — the canonical deep async
chain — repeats the recursing frame once per level; a sequential loop or a
`Promise.all` fan-out repeats nothing (~1). The detector now gates and escalates
on `recursionDepth`, so loops and fan-outs no longer fire while genuine recursion
still does. `DeepAsyncChainThresholds` is now
`{ minRecursionDepth, criticalRecursionDepth, maxFindings }`.
