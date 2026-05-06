---
mode: spawn
pid: 1234
command: "node server.js"
duration_ms: 5000
cwd: /repo
kinds: [cpu, memory, async]
lanterna_version: "1.5.1"
cpu_quality: high
memory_signal: present
async_quality: high
integrity: ok
sourcemap_coverage: 0.75
sourcemap_maps_loaded: 1
blocking_caveats: []
degrading_caveats: []
---

## Findings

| # | id                       | kind | prio | sev     | conf | proof         | decision   | location                          | impact |
| --- | ------------------------ | ---- | ---- | ------- | ---- | ------------- | ---------- | --------------------------------- | ------ |
| 1 | node-modules-hotspot:pkg | cpu  | 88   | warning | high | direct-sample | actionable | /repo/node_modules/pkg/index.js:8 | 120ms  |

## Finding 1 — node-modules-hotspot:pkg

- title: Dependency work dominates CPU
- location: /repo/node_modules/pkg/index.js:8
- user_caller: handleRequest at src/server.ts:42 (high, cpu-sample-path, support 91.0%)
- observed: none
- thresholds: none
- impact: 120ms
- why: The dependency is repeatedly sampled through user code.
- suggestion: Inspect the caller and reduce input size or call frequency.
- remediation: none

## Kind Review — cpu

- quality: high
- top_user_hotspot: handleRequest at src/server.ts:42
- hotspots:
  | # | function     | location                          | self% | total% | user_caller             |
  | --- | ------------ | --------------------------------- | ----- | ------ | ----------------------- |
  | 1 | parsePayload | /repo/node_modules/pkg/index.js:8 | 24.0% | 30.0%  | src/server.ts:42 (high) |
- hot_stacks:
  | # | anchor        | location         | weight% |
  | --- | ------------- | ---------------- | ------- |
  | 1 | handleRequest | src/server.ts:42 | 22.0%   |

## Kind Review — memory

- memory_usage: 10 samples every 250ms
- top_allocator: Buffer.alloc at node:buffer:10 — user_caller loadCache at src/cache.ts:18 (high, heap-sample-path, support 88.0%)

## Kind Review — async

- quality: high
- summary: available — 1 ops, 0 dropped
- top_async_hot_file: loadUsers at src/users.ts:27

## Files To Read First

| location         | reason                             | source  | signal     | decision     |
| ---------------- | ---------------------------------- | ------- | ---------- | ------------ |
| src/server.ts:42 | user caller for dependency hotspot | finding | 120ms      | read-first   |
| src/cache.ts:18  | memory allocator                   | memory  | 35.0% self | read-first   |
| src/users.ts:27  | top async hot file                 | async   | score 80   | inspect-lead |

## Next Steps

- The capture signal is sufficient; no rerun is required by this report.
- Read the files listed in `## Files To Read First`, then validate the hot path against the finding details and Kind Review tables.
- If the source does not explain the hotspot, trace callers and callees named in the Kind Review before changing code.
