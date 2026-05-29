---
name: lanterna-profiler
description: Drives interactive Node.js performance investigations from Lanterna CPU, memory, and async profiling reports — capture, render the agent report contract, then diagnose root cause from evidence. Use when investigating slow endpoints, latency regressions, CPU saturation, event-loop stalls, blocking I/O, sync crypto, GC pressure, memory leaks, sustained heap growth, OOM kills, off-heap Buffer pressure, deep async chains, long awaits, orphan async resources, startup cost, dependency hotspots, or any Lanterna profiling report.
---

# lanterna-profiler

Lanterna produces agent-facing Node.js profiling reports. Your job is not to summarize the report; it is to drive an interactive performance investigation until the most likely cause, missing evidence, and next measurement are clear.

## Core Rules

- The `report.agent.md` contract is the primary evidence source. Always capture in JSON, then render it: `$LANTERNA report report.json --format agent --output report.agent.md` (set `$LANTERNA` per the [Lanterna Capture & Rerun Commands](#lanterna-capture--rerun-commands) prefix). Keep `report.json` on disk for fields the agent format omits (full retainer paths, source-map failures, complete memory series). Never analyse from raw JSON, `--format text`, or `--format markdown` — JSON is a fallback for targeted field lookup, not the analysis surface.
- Do not claim a root cause without report evidence and, when code is available, confirmation from the relevant source files.
- Every recommendation must cite a concrete report observation, code observation, or be explicitly labeled a hypothesis.
- If the signal is weak, mostly idle, blocked by caveats, or not representative, stop diagnosis and ask for a rerun with a suitable workload.
- If the codebase is accessible, inspect `Files To Read First` before recommending changes; otherwise ask for the exact files/functions needed.

## Diagnostic Workflow

0. **No report yet? Capture first.** If the user gave only a target (command, PID, inspector URL), drive a capture before diagnosing — see [Lanterna Capture & Rerun Commands](#lanterna-capture--rerun-commands).
   - **Pick kinds from the symptom, do not ask blindly.** Start with `cpu`. Add `memory` for leaks, OOM, sustained RSS/heap growth, off-heap Buffer pressure, or allocation-heavy hot paths. Add `async` for long awaits, deep chains, orphan resources, or concurrency shape; pair it with `cpu` (`--kind cpu,async`) to attribute an await's latency to a cause (blocked event loop vs slow I/O vs downstream CPU). Add `--heap-snapshot-analysis` only for retainer/leak retention. Confirm with the user only when the symptom is genuinely ambiguous across CPU/memory/async.
   - Ask only for inputs you cannot infer: the target (`run -- <cmd>` / `attach --pid` / `attach --inspect-url`) is always needed; a duration for long-running targets (finite scripts/jobs can run to exit, but a duration still helps for a fixed comparison window).
   - **Workload gate.** Before capturing a long-running target, ask whether representative load is already active, whether the user will launch it, or whether the agent should launch/propose it. For HTTP servers with no workload and no readiness URL/port, pause before capture and offer concrete choices: user-driven traffic, `curl`/`autocannon`/`artillery`, or an existing project load script; also ask for `--wait-for-url` or the port/health route to build it. For `run`, include `--workload` only after the user accepts an agent-launched command. For `attach`, explain that `attach` has no `--workload`, so traffic must run externally during capture. For batch jobs, queue consumers, workers, and cron tasks, ask whether representative jobs/backlog are already active; if not, propose enqueueing jobs, replaying fixtures/payloads, running a producer/scheduler, or using an existing job script.
   - **Attaching without a known PID? List, don't guess.** When the user wants to attach to a running process but gave no `--pid` or `--inspect-url`, enumerate candidates with `$LANTERNA ps --format json` — a JSON array of live direct `node`/`nodejs` runtimes shaped as `{ pid, runtime, attachMode, command, cwd, ageMs, cpu, memory }`. Present the candidates back readably (pid · command · cwd · attach mode · CPU) and ask which one to attach to; do not pick silently, even when one stands out. Do not assume the list separates applications from tooling: commands launched by `node` can appear. Prefer `cdp-ready` targets (an inspector is already open) over `pid-attach` ones (reached best-effort via `SIGUSR1`). If the array is empty there is nothing to attach to — fall back to `run -- <cmd>` or ask for an `--inspect-url`. Then capture with `attach --pid <chosen>`.
   - After capture, the contract output is `report.agent.md`. Only then enter step 1.

1. **Clarify the performance question.** Identify the symptom (latency, throughput, CPU saturation, event-loop stalls, memory growth, OOM, GC pauses, async wait, startup, dependency cost), the user-visible impact, and the baseline (endpoint/job, expected workload, duration, p95/p99/throughput/RSS target). If the symptom is missing, ask one targeted question before deep analysis.

2. **Frontmatter Signal Gate.** Read every frontmatter signal before the findings table: `mode`, `pid`, `command`, `duration_ms`, `cwd`, `kinds`, `lanterna_version`, `cpu_quality`, `memory_quality`, `memory_signal`, `async_quality`, `integrity`, `rerun_required`, `sourcemap_coverage`, optional `sourcemap_status`/`sourcemap_maps_loaded`, `blocking_caveats`, `degrading_caveats`.
   - Use capture context (`mode`, `command`, `duration_ms`, `cwd`) to judge representativeness and build corrected commands. In attach mode, do not invent HTTP load; ask for the workload that exercises the running process.
   - Treat `kinds` as a capability list: if the symptom needs a missing kind, request a rerun with that `--kind` before diagnosing it. Use quality signals to set per-subsystem confidence; `memory_signal: usage-unavailable` blocks memory-growth claims from the usage series. Use source-map signals before treating mapped files as patch targets — low coverage or failed status means hints until source confirms.
   - Decision precedence: (1) non-empty `blocking_caveats` → hard stop, request a corrected capture; (2) `rerun_required: true` → no root cause or patch, explain the caveat / `decision = rerun` finding, request a better capture; (3) non-empty `degrading_caveats` with `rerun_required: false` → continue only for unaffected conclusions, lower confidence for degraded subsystems; (4) missing required `kind` → rerun with that `--kind`. Mostly-idle, low-sample, too-short, or non-representative captures → rerun with representative load.

3. **Build an evidence map.** Read in order, every time: frontmatter → `## Findings` table → each `## Finding N` block in table order → every present `## Kind Review` section (including kinds with no finding) → `## Files To Read First`. Use that last table as the source queue: `read-first` is primary, `inspect-lead` needs confirmation, `supporting-context` is surrounding evidence. Combine frontmatter quality, finding decision/proof/confidence, kind-review detail, source-map status, file-read decision, and `user_caller` confidence to classify each lead as proven/actionable, hypothesis (needs source), hypothesis (needs another measurement), or non-representative (needs rerun). `rerun_required: true` is the report-level rerun signal.

4. **Diagnose by subsystem** (interpretation rules per kind: [cpu-profiling.md](references/cpu-profiling.md), [memory-profiling.md](references/memory-profiling.md), [async-profiling.md](references/async-profiling.md)).
   - CPU: check `top_cpu_culprit` (self-heavy line) first, then `top_request_entry` / `top_user_hotspot` for caller context; then dependency/runtime hotspots, sync crypto, blocking I/O, JSON/serialization, require/import in hot path, generic `cpu-hotspot:*`, deopt loops, GC-correlated CPU. Claim event-loop causality only with timed event-loop data and strong correlation; an `event-loop-stall` with `hotspot-fallback` is the best CPU lead, not proof.
   - Memory / Async / Architecture: distinguish allocation churn vs JS-heap vs RSS/off-heap vs snapshot-retained growth; CPU work vs long awaits vs deep chains vs orphan resources vs low concurrency vs external waits vs attach-partial capture; and app defects vs dependency hotspots vs architectural bottlenecks vs insufficient load vs machine/container limits vs capture artifacts. See the per-kind references.

5. **Inspect source when available.** Open `read-first` files before proposing changes; treat `inspect-lead` as confirmation targets. For `node_modules`, `node:`, native, generated, or virtual source-map frames, follow the rendered `user_caller` to editable code. For `cpu-hotspot:*`, read `evidence.extra.mode`: `self` → inspect the reported function body; `inclusive-entry` → inspect callees and hot stacks first. Confirm whether hot code is on the critical request/job path, repeated per request, unbounded, synchronous, allocation-heavy, or missing backpressure/concurrency control.

6. **Iterate.** Form the smallest testable hypothesis, state the measurement that would confirm or falsify it, and give the exact Lanterna command/workload to rerun if evidence is insufficient. After any proposed fix, re-validate with the same representative workload and compare before/after metrics.

## Lanterna Capture & Rerun Commands

Resolve the prefix once so commands work whether `lanterna` is installed globally or not:

```bash
LANTERNA="$(command -v lanterna >/dev/null 2>&1 && echo lanterna || echo 'npx -y @lanterna-profiler/cli')"
```

Use `$LANTERNA` in every command. `run` requires `--` before the target; `attach` never takes `--`. Every capture is two steps: **(1) capture to `report.json`**, **(2) render the agent contract**. Keep both files — `.agent.md` drives the investigation, `.json` stays for targeted field lookup. If the user already has a `report.json`, skip step 1 and run step 2 directly.

Do not start a long-running server capture until the workload choice is explicit: traffic is already running, the user will run it during capture, or the agent will launch a command with `--workload` in `run` mode. If the target shape is unclear, ask one targeted question and propose likely workload options instead of silently capturing an idle server.

```bash
# Step 1 — capture (pick one)

# CPU only, HTTP server with readiness gate and load
$LANTERNA run --duration 30s --wait-for-url <health-url> --workload "<representative-load-command>" --format json --output report.json -- node server.js

# CPU + memory together (enables alloc-in-hot-path correlation)
$LANTERNA run --kind cpu --kind memory --duration 60s --wait-for-url <health-url> --workload "<representative-load-command>" --format json --output report.json -- node server.js

# Memory + heap snapshots (retention/leak investigation)
$LANTERNA run --kind memory --heap-snapshot-analysis --heap-snapshot-dir .lanterna-heaps --duration 120s --workload "<steady-state-load>" --format json --output report.json -- node server.js

# CPU + async (await gaps, deep chains, orphan resources)
$LANTERNA run --kind cpu --kind async --async-instrumentation safe --duration 30s --workload "<scenario-with-await-gap>" --format json --output report.json -- node server.js

# Don't know the PID? List live node/nodejs runtimes first (machine-readable),
# show the candidates, ask which to attach to, then run the attach below.
$LANTERNA ps --format json

# Attach to a running PID (attach defaults to --format json)
$LANTERNA attach --pid <pid> --duration 30s --format json --output report.json

# Step 2 — render the agent contract (mandatory, every time)
$LANTERNA report report.json --format agent --output report.agent.md
```

Use the same shape to **rerun** when signal is degraded (`rerun_required: true`, non-representative workload, mostly-idle CPU, missing kind, blocking caveats). For `run` servers without load, rerun with `--workload` (realistic headers, auth, payload, concurrency, route mix). For `attach`, run the workload externally during capture (`attach` takes no `--workload`); never invent an endpoint — ask for the representative workload. See [workload-guidance.md](references/workload-guidance.md) for autocannon/artillery examples.

## Output Format

Use [analysis-output.md](references/analysis-output.md) for substantive answers. For quick answers, still include quality, rerun status, caveats, top lead, evidence, confidence, and next step.

## Stop Conditions

Stop and ask instead of diagnosing when:

- there is neither an agent report nor a target to capture (no command, PID, or inspector URL);
- the target is an HTTP server and no representative workload can be supplied or confirmed as already active (CLI scripts, batch jobs, queue consumers, and cron tasks are exempt only when their representative work is already part of the target command or active backlog);
- the target is not Node.js;
- the report has blocking caveats, or `rerun_required: true` is present in frontmatter;
- the capture is mostly idle or the chosen workload is non-representative for the symptom;
- the frontmatter `kinds` list lacks the kind needed for the symptom;
- the user asks for a patch but the relevant source files have not been read;
- the finding is only `rerun` (no further diagnosis is possible without a better capture);
- source-map locations are virtual or generated and no editable source has been confirmed.

`hypothesis` is **not** a stop condition. For a `hypothesis` finding, do not ship a patch or claim a definitive root cause, but do continue the investigation: read the cited source, follow the `user_caller`, request the missing measurement (`--kind memory`, longer duration, etc.), and report the smallest test that would confirm or falsify the lead. Stop only on `rerun` and the clauses above.

## References

- [analysis-output.md](references/analysis-output.md) — response format and confidence rules.
- [workload-guidance.md](references/workload-guidance.md) — interactive workload design with autocannon and artillery.
- [cpu-profiling.md](references/cpu-profiling.md) — CPU, event loop, GC, deopt interpretation.
- [memory-profiling.md](references/memory-profiling.md) — memory growth, allocations, snapshots, off-heap pressure.
- [async-profiling.md](references/async-profiling.md) — async chains, awaits, orphan resources, attach caveats.
- [report-schema.md](references/report-schema.md) — targeted JSON lookup only after reading the agent report.
- [common-pitfalls.md](references/common-pitfalls.md) — Node.js remediation patterns.
- [detectors-and-plugins.md](references/detectors-and-plugins.md) — detector and plugin extension.
