---
name: lanterna-profiler
description: Profile Node.js programs with Lanterna and interpret Lanterna JSON reports. Use when investigating CPU bottlenecks, slow endpoints, hot paths, event-loop stalls, GC pressure, blocking sync I/O, sync crypto, deopt loops, or profiling reports.
---

# lanterna-profiler

## Quick Start

Use Lanterna to capture or interpret Node.js profiling reports and turn them into code-level recommendations.

Core rule: do not guess. Read the report first, then read implicated source files before proposing patches.

Before running Lanterna, detect the command prefix:

```bash
command -v lanterna >/dev/null 2>&1 && echo installed || echo use-npx
```

Use `lanterna` when the output is `installed`; otherwise use `npx -y @lanterna-profiler/cli`. The examples below use `$LANTERNA` as notation only. Replace it with the concrete prefix before executing; do not rely on shell variables persisting across separate agent tool calls.

Ask the user for the profiling duration before starting any new capture, unless they already provided one. Do not choose a default silently.

Common commands:

```bash
$LANTERNA run --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA run --deep --duration <duration> --output /tmp/lanterna-report.json -- node server.js
$LANTERNA attach --pid 4242 --duration <duration> --output /tmp/lanterna-report.json
$LANTERNA attach --pid
```

`run` requires `--` before the target command. `attach` takes `--pid`, `--pid` with no value for the interactive picker, or `--inspect-url`; it never takes `-- <command>`. `--deep` is spawn-only and is rejected by `attach`.

## Workflow

1. If the user already provided a report, skip capture. Read the report and go straight to analysis.
2. If no report exists, confirm the target command or ask whether the process is already running, and ask how long to profile.
3. For running processes, prefer `$LANTERNA attach --pid` in a TTY; otherwise list plausible Node processes and ask which PID matters.
4. For HTTP services, profile under representative load. Do not assume `autocannon`, `hey`, routes, ports, credentials, or startup sequencing.
5. Read the report in two passes: compact summary first, then `findings[]`, hotspots, event loop, GC, and deopts as needed.
6. Before patching, open `evidence.file`, read the cited function, and trace callers when evidence points at `node_modules` or a Node builtin.

Useful first-pass report query:

```bash
jq '{meta, profiles, findingsCount: (.findings | length)}' /tmp/lanterna-report.json
```

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
- infer report values that are not present.

## References

- CPU report interpretation: [cpu-profiling.md](references/cpu-profiling.md)
- Report shape and multi-kind paths: [report-schema.md](references/report-schema.md)
- Detector and plugin authoring: [detectors-and-plugins.md](references/detectors-and-plugins.md)
- Node.js remediation patterns: [common-pitfalls.md](references/common-pitfalls.md)

## Output Shape

For a report analysis, keep the answer source-backed:

```md
## Lanterna Profile - <command or pid> (<durationMs>ms)

### Summary
<onCpuRatio * 100>% on-CPU | top category: <topCategory> | <samplesTotal> samples @ <sampleIntervalMicros>us

### Findings
#### [<SEVERITY>] <title>
Location: <file>:<line> in `<function>`
Why: <why this matters in this run>
Fix: <concrete remediation or confidence caveat>

### Top Hotspots
1. `<function>` - <selfPct>% self

### GC / Event Loop / Deopts
<only claims supported by available report signals>
```
