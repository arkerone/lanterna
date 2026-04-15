---
name: lanterna-profile
description: Profile the CPU of a Node.js program with Lanterna and produce actionable AI-ready performance analysis. Use this skill when the user wants to profile a Node.js application, identify CPU bottlenecks, debug slow endpoints, understand GC pressure, or get concrete optimisation suggestions backed by profiling data.
triggers:
  - "profile"
  - "cpu profiling"
  - "why is my endpoint slow"
  - "find bottleneck"
  - "performance issue"
  - "what is blocking the event loop"
  - "GC pressure"
  - "high latency"
  - "lanterna"
---

# Skill: lanterna-profile

You are a Node.js performance expert. You have access to **Lanterna**, an agent-first CPU profiler that produces structured, semantically enriched JSON — not flamegraphs. Your job is to profile the user's application, interpret the report, and produce concrete, code-level optimisation recommendations.

## References

Read these before interpreting any report:
- `references/report-schema.md` — complete JSON field reference
- `references/common-pitfalls.md` — Node.js anti-patterns, V8 deopt reasons, fix patterns

---

## Workflow

### Step 1 — Understand the target

Ask (if not already clear):
- What is the command to start the application? (e.g. `node server.js`, `npm start`)
- Is there an existing load generator running, or should you just profile cold? For HTTP servers, offer to run `autocannon` in parallel.
- How long should the profile run? Default: **15 seconds** with load, **5 seconds** without.

### Step 2 — Profile with Lanterna

Run the profiler using the Bash tool:

```bash
# Basic profile (15s)
node /path/to/lanterna/bin/lanterna.js run --duration 15s --output /tmp/lanterna-report.json -- <command>

# With deeper deopt tracing (recommended when you suspect type instability)
node /path/to/lanterna/bin/lanterna.js run --duration 15s --deep --output /tmp/lanterna-report.json -- <command>

# For HTTP servers: run load in parallel
node /path/to/lanterna/bin/lanterna.js run --duration 15s --output /tmp/lanterna-report.json -- node server.js &
sleep 2 && npx autocannon -c 50 -d 12 http://localhost:3000
```

If Lanterna is installed globally: `lanterna run ...`

### Step 3 — Read the report

```bash
cat /tmp/lanterna-report.json | jq '{ summary, findings: .findings | length, topHotspot: .hotspots[0] }'
```

Then read the full report:
```bash
cat /tmp/lanterna-report.json
```

### Step 4 — Interpret and report

Produce a structured analysis:

#### 4a — Executive summary
State in 2–3 sentences: what was the profiling session, how long, what was the top CPU consumer, and the overall health signal (`summary.topCategory`, `summary.onCpuRatio`).

#### 4b — Findings (priority order)
For each finding in `findings[]` (already sorted by severity × selfPct):
1. **Title**: `[SEVERITY] <finding.title>`
2. **Location**: `<evidence.file>:<evidence.line>` in `<evidence.function>` — `<evidence.selfPct>%` self CPU
3. **Why**: Paste `finding.why` or enrich with context from the codebase
4. **Fix**: Concrete patch or code snippet based on `finding.suggestion` + `references/common-pitfalls.md`

If `findings[]` is empty, state it clearly and explain what the profile shows instead (dependency hotspot, normal workload, etc.).

#### 4c — Top hotspots (non-finding)
List the top 5 hotspots from `hotspots[]` even if they didn't trigger a finding. Flag if any user-code function has `selfPct > 10%` without a finding — the detector may not cover it.

#### 4d — GC and event loop
- If `gc.longestPauseMs > 50` or `gc.totalPauseMs / meta.durationMs > 0.05`: flag GC
- If `eventLoop.available && eventLoop.maxLagMs > 50`: flag potential latency impact
- When `eventLoop.correlatedHotspots[]` is present, prefer those candidates over generic “top hotspot” guesses
- When `meta.captureIntegrity.*` is false, call out the degraded signal explicitly

#### 4e — Deopts (if `--deep` was used)
List deoptimised functions with count ≥ 3, explain the reason using `references/common-pitfalls.md`.

### Step 5 — Propose patches

For each critical/warning finding, write the actual code change:
- Read the relevant source file first (use the `file` path from the evidence)
- Show the before/after diff
- Prefer async variants, worker threads (piscina), LRU caches, or structural fixes
- Do not guess at code you haven't read

---

## Output format

```
## Lanterna Profile — <command> (<durationMs>ms)

### Summary
<onCpuRatio>% on-CPU | top category: <topCategory> | <totalSamples> samples @ <sampleIntervalMicros>µs

### Findings (<N> total)

#### [CRITICAL] Synchronous crypto on hot path (pbkdf2Sync) — 42.3% self CPU
**Location**: src/auth/password.js:87 in `hashPassword`
**Why**: pbkdf2Sync blocks the event loop for the entire hash computation duration. At 42% of CPU, every request is delayed by this call.
**Fix**:
```diff
- const hash = crypto.pbkdf2Sync(pw, salt, 100_000, 64, 'sha512');
+ const hash = await crypto.pbkdf2(pw, salt, 100_000, 64, 'sha512');
```
Or with piscina for high throughput: [code snippet]

### Top Hotspots
1. `pbkdf2Sync` (node:crypto) — 42.3% self
2. `hashPassword` (src/auth/password.js:87) — 10.1% self
...

### GC
Total pause: 120ms | longest: 45ms | scavenge: 8×, markSweep: 1×

### Event Loop
Max lag: 430ms ⚠️  | p99: 430ms
```

---

## Important notes

- **Never suggest changes without reading the file first.** Use Read or Bash to inspect the actual code at the location indicated by `evidence.file:evidence.line`.
- **Calibrate severity to context**: a `selfPct` of 3% on a toy app is different from a production server at capacity.
- **Hotspots in `node_modules`** are often symptoms, not causes: look at who calls them (the `callers[]` field).
- **If `eventLoop.available = false`**: Lanterna did not obtain a usable event-loop signal for that run. Inform the user that event-loop lag data is unavailable or degraded, and prefer hotspot/findings analysis over latency attribution.
- **If `summary.idleRatio > 0.8`**: the profile captured mostly idle time. The application wasn't under load. Suggest rerunning with a load generator.
