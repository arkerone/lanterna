---
mode: spawn
pid: 4549
command: "/opt/hostedtoolcache/node/24.16.0/x64/bin/node /home/runner/work/lanterna/lanterna/examples/cpu-hotspot/app.js"
duration_ms: 6552.344
cwd: /home/runner/work/lanterna/lanterna
kinds: [cpu]
lanterna_version: "2.5.0"
cpu_quality: high
memory_quality: absent
memory_signal: absent
async_quality: absent
integrity: ok
rerun_required: false
sourcemap_coverage: 1
sourcemap_status: not-applicable
sourcemap_maps_loaded: 0
blocking_caveats: []
degrading_caveats: ["event-loop timing unavailable", "GC timing unavailable"]
---

## Findings

| # | id                      | kind | prio  | sev      | conf | proof         | decision   | location                       | impact |
| --- | ----------------------- | ---- | ----- | -------- | ---- | ------------- | ---------- | ------------------------------ | ------ |
| 1 | sync-crypto-on-hot-path | cpu  | 11970 | critical | high | direct-sample | actionable | examples/cpu-hotspot/app.js:16 | 6536ms |

## Finding 1 — sync-crypto-on-hot-path

- title: Synchronous crypto on hot path (pbkdf2Sync)
- location: examples/cpu-hotspot/app.js:16
- user_caller: hashPassword at examples/cpu-hotspot/app.js:16 (high, cpu-sample-path, support 100.0%, distance 1)
- candidate_callers: hashPassword at examples/cpu-hotspot/app.js:15 (high, cpu-sample-path, support 100.0%, distance 1); (anonymous) at examples/cpu-hotspot/app.js:1 (high, cpu-sample-path, support 100.0%, distance 2); verifyLogin at examples/cpu-hotspot/app.js:26 (high, cpu-sample-path, support 88.1%, distance 2)
- user_stack: (anonymous) at examples/cpu-hotspot/app.js:1 -> verifyLogin at examples/cpu-hotspot/app.js:26 -> hashPassword at examples/cpu-hotspot/app.js:15 (87.9% stack, leaf pbkdf2Sync at node:internal/crypto/pbkdf2:63)
- observed: selfPct=99.737 totalPct=99.753 categoryTotalPct=99.753
- thresholds: minTotalPct=1 criticalPct=10 categoryTotalPct=3
- impact: 6536ms
- why: `pbkdf2Sync` is a synchronous crypto primitive that blocks the event loop for the duration of the computation. On a server it pauses all other requests.
- suggestion: Switch to the async variant (e.g. `crypto.pbkdf2` / `crypto.scrypt` with a callback or promisified) and/or offload to a worker pool (piscina). For PBKDF2/scrypt which are CPU-bound by design, worker_threads is the right answer above a few hundred reqs/s.
- remediation: kind=async-variant replace=pbkdf2Sync with=pbkdf2 module=node:crypto notes=crypto.pbkdf2 is callback-based async; use util.promisify(pbkdf2) if the caller wants a Promise. PBKDF2 is CPU-bound — at high load also consider offloading to a worker pool (piscina).

## Kind Review — cpu

- quality: high
- hotspots:
  | # | function              | location                                | self% | total% | user_caller                           |
  | --- | --------------------- | --------------------------------------- | ----- | ------ | ------------------------------------- |
  | 1 | pbkdf2Sync            | node:internal/crypto/pbkdf2:63          | 99.7% | 99.8%  | examples/cpu-hotspot/app.js:15 (high) |
  | 2 | setupEventsource      | node:internal/process/pre_execution:360 | 0.02% | 0.02%  | —                                     |
  | 3 | wrapSafe              | node:internal/modules/cjs/loader:1745   | 0.02% | 0.02%  | —                                     |
  | 4 | reset                 | node:internal/histogram:240             | 0.02% | 0.02%  | —                                     |
  | 5 | #cachedDefaultResolve | node:internal/modules/esm/loader:683    | 0.02% | 0.02%  | —                                     |
- hot_stacks:
  | # | anchor     | location                       | weight% |
  | --- | ---------- | ------------------------------ | ------- |
  | 1 | pbkdf2Sync | node:internal/crypto/pbkdf2:63 | 87.9%   |
  | 2 | pbkdf2Sync | node:internal/crypto/pbkdf2:63 | 11.9%   |
  | 3 | evaluate   | evaluate:0                     | 0.03%   |
- hot_stack_clusters:
  | # | anchor       | location                       | weight% |
  | --- | ------------ | ------------------------------ | ------- |
  | 1 | hashPassword | examples/cpu-hotspot/app.js:15 | 99.7%   |

## Files To Read First

| location                       | reason           | source  | signal      | decision           |
| ------------------------------ | ---------------- | ------- | ----------- | ------------------ |
| examples/cpu-hotspot/app.js:16 | finding location | finding | 6536ms      | read-first         |
| examples/cpu-hotspot/app.js:1  | CPU user stack   | finding | 87.9% stack | supporting-context |
| examples/cpu-hotspot/app.js:26 | CPU user stack   | finding | 87.9% stack | supporting-context |
| examples/cpu-hotspot/app.js:15 | CPU user stack   | finding | 87.9% stack | supporting-context |
