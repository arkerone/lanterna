---
name: lanterna-profile
description: Use when profiling a Node.js program with Lanterna to investigate CPU bottlenecks, event-loop stalls, GC pressure, slow endpoints, hot paths, or deoptimisation signals.
triggers:
  - "profile"
  - "cpu profiling"
  - "why is my endpoint slow"
  - "find bottleneck"
  - "performance issue"
  - "what is blocking the event loop"
  - "gc pressure"
  - "high latency"
  - "deopt"
  - "lanterna"
---

# lanterna-profile

## Overview

Use this skill to run Lanterna against a Node.js process, inspect the JSON report, and turn the result into concrete code-level recommendations.

Core rule: do not guess. Read the report first, then read the implicated source files before proposing changes.

## When to Use

Use when:
- The user wants CPU profiling on a Node.js app or script
- A route, worker, or command is slow under load
- The user suspects blocking sync work, GC pressure, or event-loop stalls
- The user wants actionable fixes from a Lanterna JSON report

Do not use when:
- The problem is primarily memory growth or heap leaks without a CPU symptom
- The user already has a different profiler workflow they explicitly want to keep
- There is no runnable command and no existing report to inspect

## Quick Reference

- Default duration: `15s` with load, `5s` without load
- Prefer `--deep` when deopts or type instability are plausible
- For HTTP servers, profile with load rather than idle traffic
- If `summary.idleRatio > 0.8`, the run is mostly idle and should usually be repeated with load
- If `eventLoop.available` is `false`, avoid strong latency attribution
- If `meta.captureIntegrity.*` contains `false`, call out degraded signal quality

## Stop and Ask First

Do not improvise when core inputs are missing.

Stop and ask the user when:
- There is no runnable command and no existing Lanterna report
- The app needs credentials, fixtures, or a startup sequence you do not know
- The target is an HTTP service but the relevant route or traffic shape is unclear
- The user asks for code changes but you have not read the implicated source file yet

## Workflow

### 1. Confirm the profiling target

Collect the minimum information needed:
- Start command for the target program
- Whether there is already traffic or load
- Whether the user wants a quick run or deeper analysis

If the target is an HTTP server and no load generator is active, offer to run one in parallel. Do not assume `autocannon` is installed until you verify it or install it intentionally.

### 2. Run Lanterna with environment-aware commands

Prefer a local checkout or installed `lanterna` binary over hardcoded paths.

Examples:

```bash
# Local checkout
node ./bin/lanterna.js run --duration 15s --output /tmp/lanterna-report.json -- node server.js

# Installed binary
lanterna run --duration 15s --output /tmp/lanterna-report.json -- npm start

# Deeper run when deopts are relevant
node ./bin/lanterna.js run --deep --duration 15s --output /tmp/lanterna-report.json -- node server.js
```

For HTTP servers, pair the profile with real traffic. Use a verified command rather than a fixed `sleep` recipe. If you need load, start the app, wait until it is reachable, then run the load generator during most of the capture window.

### 3. Read the report in two passes

First pass: get a compact summary.

```bash
jq '{meta, summary, topHotspot: .hotspots[0], findingsCount: (.findings | length)}' /tmp/lanterna-report.json
```

Second pass: inspect only the sections you need:
- `findings[]` for priority issues
- `hotspots[]` for raw hot code
- `eventLoop` for lag signal
- `gc` for pause pressure
- `deopts[]` when `meta.deep` is `true`

Read `references/report-schema.md` when a field is unclear. Read `references/common-pitfalls.md` when turning a finding into a fix.

### 4. Decide whether the run is usable

Before writing conclusions, check whether the run should be treated as degraded or repeated.

Usually rerun instead of over-interpreting when:
- `summary.idleRatio > 0.8`
- `meta.totalSamples` is very low for the requested duration
- `eventLoop.available` is `false` and the user asked specifically about latency or stalls
- `meta.captureIntegrity.*` contains `false` for the signals you need
- The hottest frames are startup-only work and the user asked about steady-state throughput

### 5. Interpret before prescribing

Produce the analysis in this order:

1. Executive summary
State the command, duration, top CPU consumer, and the overall signal from `summary.topCategory` and `summary.onCpuRatio`.

2. Findings
For each entry in `findings[]`, include:
- Title with severity
- Location from `evidence.file:evidence.line`
- Why it matters in this run
- Concrete fix direction

3. Top hotspots
List the top user-relevant hotspots even if there is no finding. If a user-code hotspot has high `selfPct` without a finding, note that detector coverage may not explain everything.

4. GC and event loop
- Flag GC when pauses or ratios are materially high
- Flag event-loop impact only when `eventLoop.available` is true
- Prefer `eventLoop.correlatedHotspots[]` over generic hotspot guesses
- If capture integrity is degraded, say so explicitly

5. Deopts
When `meta.deep` is true, surface repeated deopts and explain them using `references/common-pitfalls.md`

### 6. Read code before proposing patches

Before suggesting edits:
- Open the exact file named in `evidence.file`
- Read the relevant function around the cited line
- Trace callers when the hotspot is in `node_modules` or a builtin

Only then propose a patch. Prefer:
- async APIs over sync APIs on request paths
- worker threads or a pool for CPU-bound work
- bounded caches over unbounded maps
- structural fixes over micro-optimisations

## Output Format

Use this structure:

```md
## Lanterna Profile — <command> (<durationMs>ms)

### Summary
<onCpuRatio>% on-CPU | top category: <topCategory> | <totalSamples> samples @ <sampleIntervalMicros>us

### Findings
#### [CRITICAL] <title>
**Location**: <file>:<line> in `<function>`
**Why**: <why this matters here>
**Fix**: <concrete remediation>

### Top Hotspots
1. `<function>` — <selfPct>% self

### GC
<relevant summary or "no material GC concern detected">

### Event Loop
<relevant summary or "event-loop signal unavailable/degraded">
```

If `findings[]` is empty, say that clearly and explain what the hotspots suggest instead.

## Common Mistakes

- Recommending code changes from `finding.suggestion` without reading the actual file first
- Treating a mostly idle profile as representative production data
- Blaming `node_modules` hotspots without checking their callers
- Claiming event-loop causality when `eventLoop.available` is false
- Treating one hot function as the root cause when the caller chain shows otherwise
- Assuming load tooling or binary paths instead of verifying the environment
- Patching a dependency or Node builtin directly instead of identifying the user-code caller that drives it
