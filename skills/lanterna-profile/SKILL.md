---
name: lanterna-profile
description: Use when profiling a Node.js program with Lanterna to investigate CPU bottlenecks, slow endpoints, hot paths, event-loop stalls, GC pressure, blocking sync I/O, sync crypto, or deopt loops — or when interpreting a Lanterna JSON report.
---

# lanterna-profile

## Overview

Use this skill to run or attach Lanterna against a Node.js process, inspect the JSON report, and turn the result into concrete code-level recommendations.

Core rule: do not guess. Read the report first, then read the implicated source files before proposing changes.

## When to Use

Use when:
- The user wants CPU profiling on a Node.js app or script
- A route, worker, or command is slow under load
- The user suspects blocking sync work, GC pressure, or event-loop stalls
- The user wants actionable fixes from a Lanterna JSON report
- The program may already be running and attach mode is a better fit than spawning a new process

Do not use when:
- The problem is primarily memory growth or heap leaks without a CPU symptom
- The user already has a different profiler workflow they explicitly want to keep
- There is no runnable command and no existing report to inspect

## Quick Reference

- Default duration: `15s` with load, `5s` without load
- Prefer `--deep` when deopts or type instability are plausible (spawn mode only)
- For HTTP servers, profile with load rather than idle traffic
- If `summary.idleRatio > 0.8`, the run is mostly idle and should usually be repeated with load
- If `eventLoop.available` is `false`, avoid strong latency attribution
- If `meta.captureIntegrity.*` contains `false`, call out degraded signal quality (see §5b for gating rules)
- Use `measurements.observed` vs `measurements.thresholds` to rank findings — do not rely on severity alone (see §5b)
- Only patch mechanically when `evidence.extra.attributionConfidence === 'high'` and `remediation` is populated; otherwise explain and ask (see §5b)
- When `lanterna` is not installed globally, substitute `npx -y @lanterna-profiler/cli` in every command
- Only Node.js targets are supported — other runtimes (Python, Rust, Go) will fail fast

## Red Flags — Stop and Restart

If any of these is true, stop what you are doing:

- You are about to propose a patch without opening `evidence.file` first
- You are about to run `lanterna run -- node server.js` (or similar) without confirming the start command
- You are about to cite `eventLoop.maxLagMs` / `p99LagMs` while `eventLoop.available === false`
- You are about to attach to the first PID returned by `ps` without asking which program matters
- You are about to recommend `--deep` on an `attach` session (not supported)
- You are about to draw conclusions from a report where `summary.idleRatio > 0.8`
- You are about to infer a number that is not present in the report (totalSamples, ratios, pauses)

When any of these fire: go back to the matching workflow step and collect the missing input.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "User is in a hurry, I'll just guess the command" | Wrong target = wrong conclusions. Asking once costs seconds; a fabricated diagnosis wastes the session. |
| "The finding already tells me what to fix" | `finding.suggestion` is generic; the cited file may already have changed. Open `evidence.file` before patching. |
| "`eventLoop.available` is false but the lag must be bad" | No histogram, no claim. Say the signal is unavailable. |
| "Only one Node process is running, it must be the right one" | Not if it's a dev watcher, test runner, or language server. Confirm with the user. |
| "The report is mostly idle but I can still pick a hotspot" | Idle profiles surface startup noise, not steady-state work. Recommend a rerun. |
| "User asked for `--deep` in attach mode, I'll still try" | Attach cannot enable `--trace-deopt`. Redirect to `lanterna run --deep --` instead. |
| "The skill shows `lanterna ...`, so I'll assume it is installed" | If the binary is absent, use `npx -y @lanterna-profiler/cli` instead of guessing install state. |

## Workflow

### 1. Confirm the profiling target (or stop and ask)

Collect the minimum information needed:
- Start command for the target program, or whether the target is already running
- Whether there is already traffic or load
- Whether the user wants a quick run or deeper analysis

Stop and ask the user when:
- There is no runnable command and no existing Lanterna report
- The app needs credentials, fixtures, or a startup sequence you do not know
- The target is an HTTP service but the relevant route or traffic shape is unclear
- The user asks for code changes but you have not read the implicated source file yet

If the target is an HTTP server and no load generator is active, offer to run one in parallel. Do not assume `autocannon`, `hey`, or `k6` is installed until you verify it.

If there is no reliable start command but there are already-running Node processes, prefer proposing `attach` instead of guessing a launch command.

### 2. If the target may already be running, list candidates and ask

When the user implies the program is already up, or when they do not know the command, prefer Lanterna's built-in interactive picker before falling back to a manual process list.

Preferred flow:

```bash
npx -y @lanterna-profiler/cli attach --pid
```

The picker narrows the list to plausible app processes and shows:
- `CDP ready` when an inspector target is already detected
- `PID attach*` for best-effort attach via `SIGUSR1` on a live, signalable process

If the picker is not usable, list candidates with a verified command:

```bash
ps -Ao pid=,command= | rg 'node|npm|pnpm|yarn|tsx|vite|next|nest'
```

Then ask the user which PID to profile, quoting a short list back to them. Example (adapt language to the user):

```text
I can attach to a process that's already running. Candidates:
- 4242 node server.js
- 4310 node dist/worker.js
- 4478 npm run dev

Which one should I profile with `lanterna attach --pid <pid>`?
```

Rules:
- Never invent a PID or assume the first process is the right one
- Prefer the built-in picker (via `lanterna` or `npx -y @lanterna-profiler/cli`) over manually pasting `ps` output
- If the list is noisy, narrow it before asking
- If there are no plausible Node targets, fall back to asking for the start command or an existing report
- If the user identifies a running process, prefer `attach` over respawning unless they explicitly want a fresh run
- If attach is chosen, remember that `--deep` is unavailable and `deopts[]` will stay empty

### 3. Run Lanterna with environment-aware commands

Prefer an installed `lanterna` binary; fall back to `npx -y @lanterna-profiler/cli` when the binary is not available. Avoid hardcoded paths.

Cheatsheet (substitute `npx -y @lanterna-profiler/cli` for `lanterna` when not installed):

| Intent | Command |
|---|---|
| Run with duration + output | `lanterna run --duration 15s --output /tmp/lanterna-report.json -- node server.js` |
| Run until child exits, pretty-print | `lanterna run --pretty -- node script.js` |
| Deep (deopts, spawn only) | add `--deep` to any `run` command |
| Attach by PID | `lanterna attach --pid 4242 --duration 15s --output /tmp/lanterna-report.json` |
| Interactive PID picker | `lanterna attach --pid` |
| Attach by inspector URL | `lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --duration 15s` |
| Lower sampling interval | add `--sample-interval 500` (halves default; `50` minimum) |
| Load external detector | add `--detectors <package-or-path>` (repeatable) |

Flag notes:
- `--sample-interval <us>` — default `1000`. Lower it (e.g. `250`) only when sub-millisecond hotspots are suspected; it inflates the profile size.
- `--output <path>` — always prefer writing to a file when the report will be post-processed with `jq` or read in multiple passes.

For HTTP servers, pair the profile with real traffic. Use a verified command rather than a fixed `sleep` recipe. If you need load, start the app, wait until it is reachable, then run the load generator during most of the capture window.

When using `attach`, explicitly call out before profiling:
- attach mode cannot enable `--deep`
- `meta.command` will be empty
- `captureIntegrity.controlChannel` is expected to be `false`
- `PID attach*` is best effort, not a guarantee that inspector startup will succeed

### 4. Read the report in two passes

First pass — compact summary:

```bash
jq '{meta, summary, topHotspot: .hotspots[0], findingsCount: (.findings | length)}' /tmp/lanterna-report.json
```

Second pass — inspect only the sections you need:
- `findings[]` for priority issues
- `hotspots[]` for raw hot code
- `eventLoop` for lag signal
- `gc` for pause pressure
- `deopts[]` when `meta.deep` is `true`

Read `references/report-schema.md` when a field is unclear. Read `references/common-pitfalls.md` when turning a finding into a fix.

### 5. Decide whether the run is usable

Before writing conclusions, check whether the run should be treated as degraded or repeated.

Usually rerun instead of over-interpreting when:
- `summary.idleRatio > 0.8`
- `meta.totalSamples` is very low for the requested duration
- `eventLoop.available` is `false` and the user asked specifically about latency or stalls
- `meta.captureIntegrity.*` contains `false` for the signals you need
- The hottest frames are startup-only work and the user asked about steady-state throughput

### 5b. Decision rules when findings conflict or compete

Findings are sorted by severity, then by `evidence.selfPct`. This is a useful default but not a decision rule — two `warning`s can dominate a `critical` in practice. Use the fields below to arbitrate before prescribing:

- `measurements.observed` vs `measurements.thresholds` — always check the gap. A `blocking-io` finding where `observed.totalPct = 18` and `thresholds.criticalPct = 10` is a much stronger lead than one at `1.2 / 1.0`. Prefer the larger ratio, all else equal.
- `evidence.extra.attributionConfidence` — on attributed findings (`blocking-io`, `sync-crypto`, `require-in-hot-path`, `node-modules-hotspot`, `json-on-hot-path`), **do not patch the user caller** when `attributionConfidence === 'low'`. Describe the symptom and recommend the user confirm the call site manually.
- `evidence.extra.eventLoopCorrelation.overlapPct` — a finding whose caller shows ≥50% overlap during measured stalls is a *causal* lead. One with no correlation at all is circumstantial.
- Correlated hotspots now carry `rank` and `confidence` (`low`/`medium`/`high`). Only attribute stall/GC pressure to a specific frame when `confidence === 'high'` (top-1 with a clear gap to top-2). Otherwise, report the ranked list and let the user choose.
- `categoryTotalPct` in `evidence.extra` is the family-wide cost (e.g. all sync fs APIs together). If it's much larger than the single-API `calleeTotalPct`, the fix is structural (get the family off the hot path) — not "replace this one call".
- `remediation.kind` / `remediation.replace` / `remediation.with` give you a mechanical patch path for ★★★ detectors (blocking-io, sync-crypto, require-in-hot-path). When present and attribution confidence is `high`, the patch can usually be applied directly at `evidence.file:evidence.line`. When missing (or for other detectors), the fix is judgment — read the caller chain first.
- `hotStackClusters[]` groups hot stacks by their user-code anchor. When several findings all point at the same anchor, treat them as one problem (one feature) rather than three patches.
- `captureIntegrity` gates the confidence of the whole report. If `controlChannelExpected && !controlChannel`, or `gcObserverAvailable === false`, degrade latency/GC claims accordingly.

When in doubt, the strongest lead is the finding where:
(a) `measurements.observed` clears `thresholds.criticalPct` by a wide margin, AND
(b) `attributionConfidence === 'high'`, AND
(c) `eventLoopCorrelation.overlapPct` is meaningful (≥30%).

A `critical` finding missing (b) or (c) is a strong *hypothesis*, not an actionable fix.

### 6. Interpret before prescribing

Produce the analysis in this order:

1. Executive summary
   State the command (or PID for attach), duration, top CPU consumer, and the overall signal from `summary.topCategory` and `summary.onCpuRatio`.

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
   When `meta.deep` is true, surface repeated deopts and explain them using `references/common-pitfalls.md`.

### 7. Read code before proposing patches

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

For spawn (`lanterna run`):

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

For attach (`lanterna attach`), `meta.command` is empty — use the PID or inspector URL instead:

```md
## Lanterna Profile — pid <N> (<durationMs>ms)
...
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
- Guessing the target command when an already-running process could have been listed and confirmed first
- Attaching blindly to the first Node PID without asking the user which running program matters
- Trying to attach to a non-Node runtime (Python, Rust, Go) — Lanterna will fail fast
- Inventing field values not present in the JSON report
