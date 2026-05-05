---
name: lanterna-profiler
description: Use when investigating Node.js CPU bottlenecks, slow endpoints, hot paths, event-loop stalls, GC pressure, blocking sync I/O, sync crypto, deopt loops, memory leaks, sustained heap growth, large allocators, off-heap Buffer pressure, Lanterna CLI captures, or Lanterna JSON profiling reports.
---

# lanterna-profiler

## Overview

Use Lanterna to capture or interpret Node.js profiling reports and turn them into source-backed recommendations.

Core rule: do not guess. Read the report first, then read implicated source files before proposing patches.

## Quick Start

Before running Lanterna, detect the command prefix:

```bash
command -v lanterna >/dev/null 2>&1 && echo installed || echo use-npx
```

Use `lanterna` when installed; otherwise use `npx -y @lanterna-profiler/cli`. Examples use `$LANTERNA` as notation only. Replace it with the concrete prefix in every command.

Ask the user for the profiling duration and representative workload before starting any new server capture, unless they already provided them. Do not choose a duration, route, port, credentials, or load scenario silently.

```bash
$LANTERNA run --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --deep --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA attach --pid 4242 --duration <duration> --output /tmp/lanterna-report.json
$LANTERNA attach --pid
$LANTERNA run --kind memory --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind memory --heap-snapshot-analysis --heap-snapshot-dir /tmp/lanterna-heaps --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind cpu --kind memory --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind async --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind async --async-instrumentation full --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --duration <duration> --wait-for-url <health-url> --workload "npx -y autocannon <base-url>" --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --no-source-maps --duration <duration> --output /tmp/lanterna-report.json -- node dist/server.js
$LANTERNA attach --pid 4242 --no-source-maps --duration <duration> --output /tmp/lanterna-report.json
$LANTERNA report /tmp/lanterna-report.json --format text
$LANTERNA report /tmp/lanterna-report.json --format markdown --output /tmp/lanterna-report.md
```

`run` requires `--` before the target command. `attach` takes `--pid`, `--pid` with no value for the interactive picker, or `--inspect-url`; it never takes `-- <command>`. `--deep` is spawn-only and is rejected by `attach`.

Use `--wait-for-url` for HTTP servers so Lanterna does not profile only startup. Use `--workload` to generate activity during the capture. The workload is a shell string executed from the same cwd and environment as Lanterna; examples include `npx -y autocannon ...`, `npx -y artillery run load.yml`, `npm run load`, `pnpm load`, `bunx ...`, and `node scripts/load.mjs`. Prefer `npx -y` for npx tools to avoid interactive install prompts.

## Capture Selection

- `--kind cpu` (default) — V8 sampling profiler, CPU detectors.
- `--kind memory` — V8 sampling heap profiler + `process.memoryUsage()` series, memory detectors.
- `--kind async` — experimental async-resource profiling. Use only for async chains, long awaits, orphan resources, or concurrency questions.
- `--async-instrumentation off|safe|full` with `--kind async` — default is `safe`; use `full` only when safe mode cannot identify await sites, because it rewrites later-loaded code and remains experimental.
- `--heap-snapshot-analysis` with `--kind memory` — heavy start/end heap snapshot comparison for retention/leak work.
- Combine `cpu` and `memory` when the user cares about both latency and allocation cost, or when `alloc-in-hot-path` correlation matters.

## Workflow

1. If the user already provided a report, skip capture. Run `$LANTERNA report <file> --format text` for a first pass, then read the JSON for exact fields and go straight to analysis.
2. If no report exists, confirm the target command or ask whether the process is already running, and ask how long to profile.
3. For running processes, prefer `$LANTERNA attach --pid` in a TTY; otherwise list plausible Node processes and ask which PID matters.
4. For HTTP services, identify readiness and traffic before capture. Prefer `run --wait-for-url <health-url> --workload "npx -y autocannon <base-url>"` for simple local load, or `--workload "npx -y artillery run load.yml"` for scenario-based load.
5. Read the report in two passes: `meta` + quality first, then `findings[]`, hotspots, event loop, GC, memory, and deopts as needed.
6. Before patching, prefer `evidence.source.file:evidence.source.line` when `evidence.source` is present (this is the original TypeScript or bundled source); fall back to `evidence.file:evidence.line` only when there is no `source` field. If `source.file` is virtual (`webpack://...`, `vite:/...`), first resolve it to a real workspace file or treat it as a label, not an editable path. Read the cited function, and trace callers when evidence points at `node_modules` or a Node builtin. The same `source` precedence applies to `hotspots[].source`, `summary.topUserHotspot.source`, `hotStacks[].frames[].source`, and `hotAllocators[].source`.
7. **When the dominant frame is external** (node_modules, node:builtin, native), look for `userCaller` on the same record before reading the call tree by hand. It points to the closest user-code frame on the sampled path and is exposed on `hotspots[]`, `hotAllocators[]`, `memory.summary.topAllocator`, `async.topOperations[]`, `async.hotFiles[]`, `async.cpuAttribution.topChains[]`, `async.summary.topAsyncHotFile`, and on `findings[].evidence.extra.userCaller`. Use `userCaller.confidence` (`high` ≥ 80 % support, `medium` for async cpu-window basis, `low` otherwise) and `userCaller.basis` (`cpu-sample-path`, `heap-sample-path`, `async-cpu-window`, `async-stack`) to decide whether to act on it directly or only treat it as an inspection lead. Patch at `userCaller.source.file:userCaller.source.line` when present, or `userCaller.file:userCaller.line` otherwise.

Useful first-pass report query:

```bash
$LANTERNA report /tmp/lanterna-report.json --format text
jq '{meta, profiles, findingsCount: (.findings | length)}' /tmp/lanterna-report.json
```

## Quality Gate

Always check quality before claiming causality:

- `profiles.cpu.quality.confidence`, `reasons[]`, and `recommendations[]`
- `meta.captureIntegrity.*` and `meta.captureIntegrity.kinds.<kind>.*`
- `meta.captureIntegrity.sourceMaps.{enabled, coverage, failures[]}` — when `enabled` and `coverage < 0.7`, treat `source.file:source.line` as a hint and keep the generated `file:line` visible as fallback context
- `finding.confidence`, `finding.proofLevel`, `priority`, and `measurements`

If confidence is low, say what is still useful, what is only a hypothesis, and what rerun would improve the signal.

## Stop Conditions

Stop and collect missing input when:

- there is no runnable command, running PID, inspector URL, or existing report;
- a new capture is needed and the user has not chosen a duration plus representative traffic;
- the target is not Node.js;
- an HTTP workload is unclear;
- a report is mostly idle or has degraded integrity for the signal the user cares about;
- a requested patch is based only on a finding summary, not inspected source.

Never:

- run `npx -y @lanterna-profiler/cli node server.js` without `run` and `--`;
- recommend global install as a prerequisite;
- attach to the first PID without confirmation;
- claim event-loop causality when the event-loop signal is unavailable or histogram-only;
- treat low-confidence `profiles.cpu.quality` as definitive;
- quote a virtual `source.file` (`webpack://`, `vite:/...`) as a fix location without first checking that the path resolves on disk — these are bundler labels, not necessarily files;
- infer report values that are not present.

## References

- CPU report interpretation: [cpu-profiling.md](references/cpu-profiling.md)
- Memory report interpretation: [memory-profiling.md](references/memory-profiling.md)
- Async report interpretation: [async-profiling.md](references/async-profiling.md)
- Report shape and multi-kind paths: [report-schema.md](references/report-schema.md)
- Detector and plugin authoring: [detectors-and-plugins.md](references/detectors-and-plugins.md)
- Node.js remediation patterns: [common-pitfalls.md](references/common-pitfalls.md)
- Analysis answer format: [analysis-output.md](references/analysis-output.md)
