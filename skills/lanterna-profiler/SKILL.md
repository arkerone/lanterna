---
name: lanterna-profiler
description: Use when investigating Node.js performance — slow endpoints, latency regressions, CPU saturation, event-loop stalls, blocking I/O, sync crypto, GC pressure, memory leaks, sustained heap growth, OOM kills, off-heap Buffer pressure, deep async chains, long awaits, orphan async resources, startup cost, dependency hotspots, or any Lanterna profiling report.
---

# lanterna-profiler

Lanterna produces agent-facing Node.js profiling reports. Your job is not to summarize the report; it is to drive an interactive performance investigation until the most likely cause, missing evidence, and next measurement are clear.

## Core Rules

- The `report.agent.md` contract is the primary evidence source. Always capture in JSON, then render the agent contract: `$LANTERNA report report.json --format agent --output report.agent.md` (set `$LANTERNA` per the [Lanterna Capture & Rerun Commands](#lanterna-capture--rerun-commands) prefix). Keep `report.json` on disk so you can retrieve fields not rendered by the agent format (full retainer paths, source-map failures, complete memory series). Never analyse from raw JSON, `--format text`, or `--format markdown` — JSON is a fallback for targeted field lookup, not the analysis surface.
- Do not claim a root cause without evidence from the report and, when code is available, confirmation from relevant source files.
- Every recommendation must cite a concrete report observation, code observation, or explicitly be labeled as a hypothesis.
- If the signal is weak, mostly idle, blocked by caveats, or not representative, stop diagnosis and ask for a rerun with a suitable workload.
- If the codebase is accessible, inspect `Files To Read First` before recommending changes. If it is not accessible, ask for the exact files/functions needed.

## Diagnostic Workflow

0. **No report yet? Capture first.**
   - If the user only provided a target (command, PID, inspector URL) without a report, drive a capture before diagnosing. See [Lanterna Capture & Rerun Commands](#lanterna-capture--rerun-commands).
   - **Default kinds — pick from the symptom, do not ask blindly.** Start with `cpu`. Add `memory` when the symptom is a leak, OOM, sustained RSS/heap growth, off-heap Buffer pressure, or allocation-heavy hot path. Add `async` when the symptom is long awaits, deep async chains, orphan resources, or concurrency shape. Add `--heap-snapshot-analysis` only for retainer / leak retention investigations. Confirm the selection with the user only when the symptom is genuinely ambiguous between CPU, memory, and async.
   - Ask the user for the inputs you cannot infer: target (`run -- <cmd>` / `attach --pid` / `attach --inspect-url`) and duration are always needed; for HTTP servers also ask for a representative `--workload` and a `--wait-for-url` readiness URL. CLI scripts, batch jobs, queue consumers, and cron tasks usually do not need an external workload — the target itself drives the load.
   - After capture, the contract output is `report.agent.md`. Only then enter step 1.

1. **Clarify the performance question**
   - Identify the symptom: latency, throughput, CPU saturation, event-loop stalls, memory growth, OOM, GC pauses, async wait, startup, or dependency cost.
   - Identify the user-visible impact and target baseline: endpoint/job, expected workload, duration, p95/p99/throughput/RSS target when available.
   - If the user did not provide the symptom, ask one targeted question before deep analysis.

2. **Gate the report quality**
   - Read frontmatter first: `kinds`, `cpu_quality`, `memory_signal`, `async_quality`, `integrity`, source-map coverage, `blocking_caveats`, `degrading_caveats`.
   - If `blocking_caveats` is non-empty, do not diagnose. Explain the blocker and request a corrected capture.
   - If CPU idle ratio is mostly idle, sample count is low, capture is too short, or workload is not representative, request a rerun using `--workload`.
   - If a needed kind is absent, request a new capture with the needed `--kind`.

3. **Build an evidence map**
   - Read in order, every time: frontmatter → `## Findings` table → each `## Finding N` block in table order → every present `## Kind Review` section (including kinds with no finding) → `## Files To Read First` → `## Next Steps`. Do not skip a `Kind Review` for a kind listed in frontmatter `kinds`.
   - Use `## Files To Read First` as the source inspection queue: `read-first` rows are the primary queue, `inspect-lead` rows need confirmation, `supporting-context` rows explain surrounding evidence.
   - Classify each lead as `proven/actionable`, `hypothesis needing source confirmation`, `hypothesis needing another measurement`, or `non-representative signal requiring rerun`.

4. **Diagnose by subsystem** (see per-kind references for interpretation rules: [cpu-profiling.md](references/cpu-profiling.md), [memory-profiling.md](references/memory-profiling.md), [async-profiling.md](references/async-profiling.md))
   - CPU: check top user hotspot, dependency/runtime hotspot with user caller, sync crypto, blocking I/O, JSON/serialization, require/import in hot path, deopt loops, and GC-correlated CPU.
   - Event loop: only claim causality when event-loop timing is available and hotspot correlation is strong.
   - Memory: distinguish allocation churn, JS heap growth, RSS/off-heap growth, external Buffer pressure, snapshot-retained growth, and weak short-window slopes.
   - Async/I/O: distinguish CPU work from long awaits, deep chains, orphan resources, low concurrency, external service waits, and attach-mode partial capture.
   - Architecture/dependency/environment: separate app code defects, dependency hotspots, architectural bottlenecks, insufficient load, machine/container limits, and capture artifacts.

5. **Inspect source when available**
   - Open `read-first` files before proposing changes.
   - Treat `inspect-lead` as confirmation targets, not patch targets.
   - For `node_modules`, `node:`, native, generated output, or virtual source-map frames, follow the rendered `user_caller` to editable user code.
   - Confirm whether hot code is on the critical request/job path, repeated per request, unbounded, synchronous, allocation-heavy, or missing backpressure/concurrency control.

6. **Iterate**
   - Formulate the smallest testable hypothesis.
   - Say what measurement would confirm or falsify it.
   - If evidence is insufficient, provide the exact Lanterna command/workload to rerun.
   - After any proposed fix, require validation with the same representative workload and compare before/after metrics.

## Lanterna Capture & Rerun Commands

Resolve the Lanterna prefix as a shell variable so every command below works whether `lanterna` is installed globally or not:

```bash
LANTERNA="$(command -v lanterna >/dev/null 2>&1 && echo lanterna || echo 'npx -y @lanterna-profiler/cli')"
```

Use `$LANTERNA` in every capture and render command. `run` requires `--` before the target command; `attach` never takes `--`. Every capture is a two-step flow: **(1) capture to `report.json`**, **(2) render the agent contract**. Keep both files on disk — the `.agent.md` drives the investigation, the `.json` stays available for targeted field lookup.

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

# Attach to a running PID (attach defaults to --format json, kept explicit for clarity)
$LANTERNA attach --pid <pid> --duration 30s --format json --output report.json

# Step 2 — render the agent contract (mandatory, every time)
$LANTERNA report report.json --format agent --output report.agent.md
```

If the user already has a `report.json`, skip step 1 and run step 2 directly.

Use the **first capture** form when there is no report yet. Use the **rerun** form (same shape) when the existing report has degraded signal — typically a non-representative workload, mostly-idle CPU, missing kind, or `blocking_caveats`. For server profiles without load, ask the user to rerun with `--workload`, including realistic headers, auth, payload, concurrency, and route mix. See [workload-guidance.md](references/workload-guidance.md) for autocannon/artillery examples. Do not invent an endpoint for attach mode; ask for the representative workload.

## Output Format

Use [analysis-output.md](references/analysis-output.md) for substantive answers. For quick answers, still include quality, top lead, evidence, confidence, and next step.

## Stop Conditions

Stop and ask instead of diagnosing when:

- there is neither an agent report nor a target to capture (no command, PID, or inspector URL);
- the target is an HTTP server and no representative workload can be supplied — for CLI scripts, batch jobs, queue consumers, or cron tasks this clause does not apply because the target drives its own load;
- the target is not Node.js;
- the report has blocking caveats;
- the capture is mostly idle or the chosen workload is non-representative for the symptom;
- the user asks for a patch but the relevant source files have not been read;
- the finding is only `rerun` (no further diagnosis is possible without a better capture);
- source-map locations are virtual or generated and no editable source has been confirmed.

`hypothesis` is **not** a stop condition. When a finding is `hypothesis`, do not ship a patch or claim a definitive root cause, but do continue the investigation: read the cited source, follow the `user_caller`, request the missing measurement (`--kind memory`, longer duration, etc.), and report the smallest test that would confirm or falsify the lead. Stop only on `rerun` and the other clauses above.

## References

- [analysis-output.md](references/analysis-output.md) — response format and confidence rules.
- [workload-guidance.md](references/workload-guidance.md) — interactive workload design with autocannon and artillery.
- [cpu-profiling.md](references/cpu-profiling.md) — CPU, event loop, GC, deopt interpretation.
- [memory-profiling.md](references/memory-profiling.md) — memory growth, allocations, snapshots, off-heap pressure.
- [async-profiling.md](references/async-profiling.md) — async chains, awaits, orphan resources, attach caveats.
- [report-schema.md](references/report-schema.md) — targeted JSON lookup only after reading the agent report.
- [common-pitfalls.md](references/common-pitfalls.md) — Node.js remediation patterns.
- [detectors-and-plugins.md](references/detectors-and-plugins.md) — detector and plugin extension.
