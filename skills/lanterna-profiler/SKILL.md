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

Ask the user for the profiling duration before starting any new capture, unless they already provided one. Do not choose a default silently.

```bash
$LANTERNA run --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --deep --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA attach --pid 4242 --duration <duration> --output /tmp/lanterna-report.json
$LANTERNA attach --pid
$LANTERNA run --kind memory --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind memory --heap-snapshot-analysis --heap-snapshot-dir /tmp/lanterna-heaps --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --kind cpu --kind memory --duration <duration> --output /tmp/lanterna-report.json -- node server.js
```

`run` requires `--` before the target command. `attach` takes `--pid`, `--pid` with no value for the interactive picker, or `--inspect-url`; it never takes `-- <command>`. `--deep` is spawn-only and is rejected by `attach`.

## Capture Selection

- `--kind cpu` (default) — V8 sampling profiler, CPU detectors.
- `--kind memory` — V8 sampling heap profiler + `process.memoryUsage()` series, memory detectors.
- `--heap-snapshot-analysis` with `--kind memory` — heavy start/end heap snapshot comparison for retention/leak work.
- Combine `cpu` and `memory` when the user cares about both latency and allocation cost, or when `alloc-in-hot-path` correlation matters.

## Workflow

1. If the user already provided a report, skip capture. Read the report and go straight to analysis.
2. If no report exists, confirm the target command or ask whether the process is already running, and ask how long to profile.
3. For running processes, prefer `$LANTERNA attach --pid` in a TTY; otherwise list plausible Node processes and ask which PID matters.
4. For HTTP services, profile under representative load. Do not assume `autocannon`, `hey`, routes, ports, credentials, or startup sequencing.
5. Read the report in two passes: `meta` + quality first, then `findings[]`, hotspots, event loop, GC, memory, and deopts as needed.
6. Before patching, open `evidence.file`, read the cited function, and trace callers when evidence points at `node_modules` or a Node builtin.

Useful first-pass report query:

```bash
jq '{meta, profiles, findingsCount: (.findings | length)}' /tmp/lanterna-report.json
```

## Quality Gate

Always check quality before claiming causality:

- `profiles.cpu.quality.confidence`, `reasons[]`, and `recommendations[]`
- `meta.captureIntegrity.*` and `meta.captureIntegrity.kinds.<kind>.*`
- `finding.confidence`, `finding.proofLevel`, `priority`, and `measurements`

If confidence is low, say what is still useful, what is only a hypothesis, and what rerun would improve the signal.

## Stop Conditions

Stop and collect missing input when:

- there is no runnable command, running PID, inspector URL, or existing report;
- a new capture is needed and the user has not chosen a duration;
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
- infer report values that are not present.

## References

- CPU report interpretation: [cpu-profiling.md](references/cpu-profiling.md)
- Memory report interpretation: [memory-profiling.md](references/memory-profiling.md)
- Report shape and multi-kind paths: [report-schema.md](references/report-schema.md)
- Detector and plugin authoring: [detectors-and-plugins.md](references/detectors-and-plugins.md)
- Node.js remediation patterns: [common-pitfalls.md](references/common-pitfalls.md)
- Analysis answer format: [analysis-output.md](references/analysis-output.md)
