---
name: lanterna-profiler
description: Use when investigating Node.js CPU bottlenecks, slow endpoints, hot paths, event-loop stalls, GC pressure, blocking sync I/O, sync crypto, deopt loops, memory leaks, sustained heap growth, large allocators, off-heap Buffer pressure, Lanterna CLI captures, or Lanterna profiling reports.
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

Ask the user for the profiling target, duration, representative workload, and HTTP readiness URL before starting any new capture, unless they already provided them. The target is either a command to run, a PID, or an inspector URL. Do not choose a PID, duration, route, port, credentials, or load scenario silently.

```bash
$LANTERNA run --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --duration <duration> --format agent --output /tmp/lanterna-report.agent.md -- node server.js
$LANTERNA run --deep --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA attach --pid 4242 --duration <duration> --output /tmp/lanterna-report.json
$LANTERNA attach --pid 4242 --duration <duration> --format agent --output /tmp/lanterna-report.agent.md
$LANTERNA attach --pid
$LANTERNA run --kind memory --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind memory --heap-snapshot-analysis --heap-snapshot-dir /tmp/lanterna-heaps --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind cpu --kind memory --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind async --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind async --async-instrumentation full --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --duration <duration> --wait-for-url <health-url> --workload "npx -y autocannon <base-url>" --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --no-source-maps --duration <duration> --output /tmp/lanterna-report.json -- node dist/server.js
$LANTERNA attach --pid 4242 --no-source-maps --duration <duration> --output /tmp/lanterna-report.json
$LANTERNA report /tmp/lanterna-report.json --format agent --output /tmp/lanterna-report.agent.md
# Human-readable only; agents must analyze report.agent.md first.
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

### Existing report

1. If the user already provided a JSON report, skip capture. First render it with the deterministic agent format: `$LANTERNA report <file> --format agent --output <file>.agent.md`. This first read is mandatory; do not start from `--format text`, `--format markdown`, or raw JSON.
2. Read the agent report in this order and keep that order in your reasoning: `Capture` -> `Signal Gate` -> `Action Queue` -> `Evidence Pack` -> `Decision Rules` -> `Kind Review` -> `Files To Read First` -> implicated source files -> conclusion.
3. Apply `Signal Gate` before treating findings as proof. Low confidence, `heuristic`, `trace-only`, degraded integrity, weak source-map coverage, memory caveats, or async caveats mean hypothesis or rerun, not a patch basis.
4. Follow `Action Queue` in Lanterna order. Do not reorder findings by intuition.
5. Read `Evidence Pack` and `Decision Rules` before deciding whether an item is actionable. A `high` `userCaller` can be actionable only when the finding confidence, proof level, action confidence, and signal gate are also actionable. `medium` and `low` `userCaller` attributions are inspection leads only.
6. Perform `Kind Review` for every kind listed in the agent report's `Capture` section, including reports with no findings. For custom kinds, do not assume `kind.id === report.profiles` section key beyond what the report declares.
7. Read `Files To Read First` before proposing patches. Prefer source-map locations and keep generated fallbacks visible when source-map coverage is low.
8. Consult the JSON only for targeted fields not yet rendered by the agent report. Do not use raw JSON to invent a stronger conclusion than the agent report supports.

### New capture

1. Ask only for information that cannot be discovered safely: command or PID/inspector URL, duration, representative workload, and readiness URL for HTTP servers.
2. Before capture, ask concrete questions for any missing items: "What command, PID, or inspector URL should I profile?", "How long should the representative capture run?", "What workload should run during the capture?", and, for HTTP servers, "What readiness URL should Lanterna wait for before starting load?"
3. Do not choose duration, PID, route, port, credentials, or workload silently. Do not attach to the first PID found.
4. For running processes, prefer `$LANTERNA attach --pid` in a TTY; otherwise list plausible Node processes and ask which PID matters.
5. For HTTP services, identify readiness and traffic before capture. Prefer `run --wait-for-url <health-url> --workload "npx -y autocannon <base-url>"` for simple local load, or `--workload "npx -y artillery run load.yml"` for scenario-based load.
6. Prefer the robust two-step path: capture JSON (`--output /tmp/lanterna-report.json`), then render `$LANTERNA report /tmp/lanterna-report.json --format agent --output /tmp/lanterna-report.agent.md`. Use `--format agent` directly on `run` or `attach` only when immediate agent output is the goal.
7. Before patching, prefer `source.file:source.line` when `source` is present, but keep the generated fallback `file:line` visible in your notes. If `source.file` is virtual (`webpack://...`, `vite:/...`, etc.) or cannot be found in the workspace, treat it as a label, not an editable path. Read the cited function, and trace callers when evidence points at `node_modules`, Node builtins, or native frames.
8. **When the dominant frame is external** (node_modules, node:builtin, native), look for `userCaller` on the same record before reading the call tree by hand. It points to the closest user-code frame on the sampled path. Use `userCaller.confidence` (`high` ≥ 80 % support, `medium` for async cpu-window basis, `low` otherwise) and `userCaller.basis` (`cpu-sample-path`, `heap-sample-path`, `async-cpu-window`, `async-stack`) to decide whether to act on it directly or only treat it as an inspection lead. For locations, `userCaller.source.file:userCaller.source.line` wins, but keep `userCaller.file:userCaller.line` as generated fallback.

Required first-pass report rendering:

```bash
$LANTERNA report /tmp/lanterna-report.json --format agent --output /tmp/lanterna-report.agent.md
```

Use `jq` only after reading `report.agent.md`, and only to answer a targeted question about a field the agent report does not render yet.

## Kind Review Rules

Run the matching review for every kind listed in the agent report's `Capture` section. The field paths below are JSON lookup paths for targeted clarification only; do not start analysis from them.

### CPU

Check:

- `profiles.cpu.quality`
- `profiles.cpu.summary.topUserHotspot.source`
- `profiles.cpu.hotspots[].source`
- `profiles.cpu.hotspots[].userCaller`
- `profiles.cpu.hotStacks[].frames[].source`
- `profiles.cpu.hotStackClusters[].anchor.source`
- `findings[].evidence.source` for CPU findings

Never patch an external CPU hotspot directly without looking for `userCaller` or another user-code caller.

### Memory

Check:

- `profiles.memory.summary.topAllocator.source`
- `profiles.memory.summary.topAllocator.userCaller`
- `profiles.memory.hotAllocators[].source`
- `profiles.memory.hotAllocators[].userCaller`
- `profiles.memory.memoryUsage`
- `profiles.memory.heapSnapshotAnalysis` when present
- `findings[].evidence.source` for memory findings

For external or native allocators, use `userCaller` as the inspection point. Do not treat the allocator frame itself as the patch location.

### Async

Check:

- `profiles.async.quality`
- `profiles.async.summary.topAsyncHotFile.source`
- `profiles.async.summary.topAsyncHotFile.userCaller`
- `profiles.async.topOperations[].userCaller`
- `profiles.async.hotFiles[].userCaller`
- `profiles.async.cpuAttribution.topChains[].userCaller`
- frame `source` fields on `initFrame`, `primaryFrame`, `awaitFrame`, `executionFrame`, and `cdpAsyncContextFrame`
- `findings[].evidence.source` for async findings

Do not assume an async finding always has `evidence.extra.userCaller`. If it is absent, read the async aggregates above before concluding.

### Multi-Kind

- For `alloc-in-hot-path`, verify both CPU and memory evidence before concluding.
- For `hot-async-context`, verify both CPU and async evidence before concluding.
- For custom kinds, inspect the declared kind and report shape without assuming the built-in section naming rules.

## Quality Gate

Always check quality before claiming causality:

- Agent `Signal Gate`: CPU quality, integrity, blocking caveats, degrading caveats, and source-map coverage.
- Agent `Action Queue`, `Evidence Pack`, and `Decision Rules`: finding confidence, proof level, priority, action confidence, measurements, and actionability.
- Agent `Kind Review`: CPU, memory, and async summaries for every kind in `Capture`.
- Targeted JSON only when the rendered agent report omits a needed detail such as `meta.captureIntegrity.sourceMaps.failures[]`, full memory samples, heap snapshot retainer paths, or an async frame not printed in `Kind Review`.

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
- fall back to `--format text` when deterministic agent analysis requires `--format agent`;
- skip the agent order (`Capture` -> `Signal Gate` -> `Action Queue` -> `Evidence Pack` -> `Decision Rules` -> `Kind Review` -> `Files To Read First` -> source reading -> conclusion);
- skip `Kind Review` for any kind listed in agent `Capture`;
- patch from `suggestion` alone without reading implicated source;
- treat `heuristic`, `trace-only`, low confidence, or degraded signal as proof;
- treat `medium` or `low` `userCaller.confidence` as a patch location instead of an inspection lead;
- reorder findings by intuition instead of following `Action Queue`;
- claim event-loop causality when the event-loop signal is unavailable or histogram-only;
- treat low-confidence agent `Signal Gate` CPU quality as definitive;
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
