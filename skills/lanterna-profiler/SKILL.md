---
name: lanterna-profiler
description: Use when investigating Node.js CPU bottlenecks, slow endpoints, hot paths, event-loop stalls, GC pressure, blocking sync I/O, sync crypto, deopt loops, memory leaks, sustained heap growth, large allocators, off-heap Buffer pressure, async chains and long awaits, Lanterna captures, or Lanterna profiling reports.
---

# lanterna-profiler

## Overview

Lanterna captures Node.js CPU, memory, and async profiles and renders them as a deterministic agent-facing markdown report. Read that report, then read implicated source files, then propose patches. Do not guess.

## Tool prefix

```bash
command -v lanterna >/dev/null 2>&1 && echo installed || echo use-npx
```

Use `lanterna` if installed, else `npx -y @lanterna-profiler/cli`. Examples below write `$LANTERNA` — substitute the concrete prefix every time.

## Capture (only when there is no report yet)

Ask the user, before capturing anything, for any item missing from this list — never silently choose:

- target: command (`run -- <command>`), PID (`attach --pid`), or inspector URL (`attach --inspect-url`)
- duration
- representative workload (shell string run during the capture)
- readiness URL for HTTP servers

Canonical commands:

```bash
$LANTERNA run    --duration <dur> --output /tmp/r.json -- node server.js
$LANTERNA run    --duration <dur> --wait-for-url <url> --workload "npx -y autocannon <base>" --output /tmp/r.json -- node server.js
$LANTERNA attach --pid 4242 --duration <dur> --output /tmp/r.json
$LANTERNA run    --kind cpu --kind memory --duration <dur> --output /tmp/r.json -- node server.js
$LANTERNA run    --kind memory --heap-snapshot-analysis --heap-snapshot-dir /tmp/heaps --duration <dur> --output /tmp/r.json -- node server.js
$LANTERNA run    --kind async --async-instrumentation safe --duration <dur> --output /tmp/r.json -- node server.js
```

Rules: `run` requires `--` before the target; `attach` never takes `--`. `--deep` is `run`-only. Use `--kind cpu,memory` together when latency and allocation matter, or to enable the `alloc-in-hot-path` correlation. `--async-instrumentation full` only when `safe` cannot find await sites.

After capture, render the agent report:

```bash
$LANTERNA report /tmp/r.json --format agent --output /tmp/r.agent.md
```

This step is mandatory. Never start analysis from raw JSON, `--format text`, or `--format markdown`.

## The agent report

The file `report.agent.md` is the single source of truth for analysis. Structure:

```
---
mode: spawn|attach
pid: <n>
command: "<argv joined>"
duration_ms: <n>
cwd: <path>
kinds: [cpu, memory, async, ...]
lanterna_version: <semver>
cpu_quality: high|medium|low|absent
memory_signal: present|usage-unavailable|absent
async_quality: high|medium|low|absent
integrity: ok|degraded|unknown
sourcemap_coverage: 0..1 | null
sourcemap_maps_loaded: <n>            # only when sourcemap_coverage != null
blocking_caveats: ["..."]             # block all conclusions until resolved
degrading_caveats: ["..."]            # weaken signal but don't block
---

## Findings
| # | id | kind | prio | sev | conf | proof | decision | location | impact |
| - | -- | ---- | ---- | --- | ---- | ----- | -------- | -------- | ------ |
| 1 | sync-crypto | cpu | 92 | warning | high | direct-sample | actionable | src/auth.ts:42 | 320ms |

## Finding 1 — <id>
- title, location (with fallback), user_caller (when present), observed, thresholds,
  impact, why, suggestion, remediation

## Kind Review — cpu | memory | async | <custom>
- scalar context lines + nested tables for hotspots / allocators / operations / chains

## Files To Read First
| location | reason | source | signal | decision |
| -------- | ------ | ------ | ------ | -------- |
| src/auth.ts:42 | finding location | finding | 320ms | read-first |
| src/routes.ts:18 | user caller for dependency hotspot | cpu | 37.5% self | inspect-lead |

## Next Steps
- The capture signal is sufficient; no rerun is required by this report.
- Read the files listed in `## Files To Read First`, then validate the hot path.
```

## How to read it

Read in this order, every time:

1. **Frontmatter.** If `blocking_caveats` is non-empty, stop and rerun (or fix the capture) before drawing any conclusion. If `*_quality` is `low` or `degrading_caveats` is non-empty, reduce confidence and prefer hypothesis language; rerun if precision matters.
2. **`## Findings` table.** This is the action queue, in order. Each row carries everything you need to triage:
   - `decision = actionable` → patch is on the table once you have read the source.
   - `decision = hypothesis` → inspection lead only. Confirm before patching.
   - `decision = rerun` → signal is too weak; do not patch from this report.
   - `location` is already source-mapped to the user's editable file when possible.
3. **`## Finding N — <id>` blocks** (in table order, do not reorder by intuition).
   - `user_caller` is the closest user-code frame on the sampled path. Treat its `(confidence)` as gating: only `high` callers are direct patch locations; `medium`/`low` are inspection leads.
   - `location` line with `(fallback …)` shows the generated file as well — keep it visible when source-map coverage is low.
4. **`## Kind Review — <kind>`** for every kind listed in frontmatter `kinds`, including reports with no findings. The Kind Review tables (hotspots, allocators, top_operations, hot_files, cpu_attribution) carry the broader picture even when no detector fired.
5. **`## Files To Read First`.** Open the table's `location` entries before suggesting changes. `decision = read-first` is the primary source-reading queue; `inspect-lead` needs confirmation before patching; `supporting-context` explains the surrounding path. Runtime, dependency, pnpm store, virtual source-map, and pseudo-frame locations are intentionally excluded unless there is an editable user-code `userCaller`. Generated output folders (`dist/`, `build/`, `.next/`, etc.) are `inspect-lead` fallbacks, not direct patch targets. Use `reason` and `signal` to understand whether the row came from a finding, dependency/runtime caller, CPU stack, memory allocator, or async lead.
6. **`## Next Steps`.** Follow the checklist. If the signal is degraded or mostly idle, collect a new capture under representative load before patching. The agent renderer treats CPU idle ratio ≥ 90% as mostly idle. For `attach`, confirm the application workload before rerunning; do not invent an HTTP benchmark target.

The report is self-contained. Consult the raw JSON only for a specific field that the agent report does not render (e.g. `meta.captureIntegrity.sourceMaps.failures[]`, full memory series, heap snapshot retainer paths). Never let JSON spelunking talk you into a stronger conclusion than the agent report supports.

## Kind Review essentials

- **cpu** — `top_user_hotspot` is your default starting point. For `hotspots` rows whose `location` is external (`node_modules`, `node:`, native), the `user_caller` column points at the patch site; the row itself is not. `hot_stacks` and `hot_stack_clusters` show recurring code paths around those frames.
- **memory** — `top_allocator` and the `allocators` table behave like CPU hotspots; the `user_caller` column is again the patch site for external allocators. `memory_usage` describes the RSS/heap series; `heap_snapshot` lines (when present) show start/end retention deltas, including `top_growing_constructor` and `heap_snapshot_warnings`.
- **async** — `top_operations` (long-running), `hot_files` (await density), `cpu_attribution.topChains` (CPU paid by an async chain). Async findings frequently have no `user_caller` on the finding itself; fall back to the `user_caller` columns in these tables.
- **multi-kind correlations** — `alloc-in-hot-path` requires CPU + memory both present; `hot-async-context` requires CPU + async. Verify both signals before concluding.
- **custom kinds** — the section says so explicitly; do not assume built-in field names.

## Stop conditions

Stop and ask, do not improvise, when:

- there is no runnable command, running PID, inspector URL, or existing report;
- a new capture is needed and duration / workload / readiness URL are still unknown;
- the target is not Node.js;
- the report is mostly idle, has `blocking_caveats`, or `degrading_caveats` undermine the signal the user cares about;
- a requested patch is based only on a `suggestion` line, with the source file unread.

## Never

- run `npx -y @lanterna-profiler/cli node server.js` (missing `run` and `--`);
- recommend a global install as a prerequisite;
- attach to the first PID found without confirming;
- start analysis from `--format text`, `--format markdown`, or raw JSON instead of `--format agent`;
- skip a `## Kind Review — <kind>` section for a kind that appears in frontmatter `kinds`;
- reorder findings by intuition instead of following the `## Findings` table;
- patch when `decision` is `hypothesis` or `rerun`;
- patch from a `Files To Read First` row whose `decision` is `inspect-lead` or `supporting-context` without confirming it in source;
- treat `medium` or `low` `user_caller` confidence as a patch location;
- claim event-loop causality when `degrading_caveats` includes `event-loop timing unavailable`;
- quote a virtual `source.file` (`webpack://`, `vite:/…`) as a fix location without confirming the path resolves on disk — these are bundler labels, not files;
- infer fields that are not present in the report.

## References

- [cpu-profiling.md](references/cpu-profiling.md) — CPU report interpretation.
- [memory-profiling.md](references/memory-profiling.md) — memory report interpretation.
- [async-profiling.md](references/async-profiling.md) — async report interpretation.
- [report-schema.md](references/report-schema.md) — agent report layout + JSON schema for targeted lookups.
- [detectors-and-plugins.md](references/detectors-and-plugins.md) — detector and plugin authoring.
- [common-pitfalls.md](references/common-pitfalls.md) — Node.js remediation patterns.
- [analysis-output.md](references/analysis-output.md) — answer format expected from you.
