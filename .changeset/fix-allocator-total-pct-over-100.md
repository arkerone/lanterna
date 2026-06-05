---
"@lanterna-profiler/core": patch
---

Fix memory allocator `totalPct` (and the derived `alloc-in-hot-path` `combinedPct`) exceeding 100%. Inclusive `totalBytes` was summed once per occurrence of a frame, so a frame that recurses into itself (module bootstrap loading does this constantly) had the bytes of its nested subtrees counted multiple times — producing impossible percentages like 300%. Inclusive bytes are now counted only at a frame's outermost occurrence on each call path; self bytes still sum across every occurrence.
