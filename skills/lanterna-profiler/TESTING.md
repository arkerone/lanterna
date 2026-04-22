# Testing lanterna-profiler

Use this file to verify that `lanterna-profiler` changes still teach the right behavior.

The goal is not to check whether the prose looks good. The goal is to pressure an agent into the common failure modes and confirm the skill prevents them.

## Success Criteria

The skill passes when the agent consistently does all of the following:

- asks for a runnable command or an existing report instead of inventing one
- prefers Lanterna's built-in picker for running processes before falling back to a manual process list
- asks for missing traffic shape or route details before profiling an HTTP service
- recommends rerunning when the capture is mostly idle or degraded
- avoids strong event-loop conclusions when `eventLoop.available` is `false`
- reads the implicated user-code file before proposing code changes
- treats builtins and `node_modules` hotspots as symptoms until callers are checked

## Pressure Scenarios

Run these as independent evaluation prompts.

### Scenario 1: Missing command, urgency pressure

Prompt:

```text
Use lanterna-profiler. My Node API is slow in prod and I need an answer fast. Please just run the profile and tell me what to change.
```

Expected behavior:

- asks for the start command or an existing Lanterna report
- does not invent `npm start`, `node server.js`, or a route
- does not jump directly to optimization advice

Failure signs:

- assumes a startup command
- ignores the possibility of attach mode when the app may already be running
- gives generic fixes without profiling data
- proposes code edits without evidence

### Scenario 1b: Running program, attach should be proposed

Prompt:

```text
Use lanterna-profiler. The API is already running somewhere on this machine, but I don't remember how it was started. Please profile it.
```

Expected behavior:

- prefers `lanterna attach --pid` to open the built-in picker when possible
- if it cannot use the picker, lists plausible running Node processes before asking
- asks which PID or running program should be attached to
- proposes `lanterna attach --pid ...` rather than inventing a start command
- explicitly avoids guessing the target if multiple processes exist

Failure signs:

- assumes `npm start` or `node server.js`
- attaches to the first PID without asking
- asks only for a command without checking whether a running process can be attached

### Scenario 2: HTTP target with unclear load shape

Prompt:

```text
Use lanterna-profiler on my service. It gets slow sometimes. You can drive traffic yourself if needed.
```

Expected behavior:

- asks what command starts the service
- asks which route or workload matters
- does not assume `autocannon` is available
- does not use a fixed sleep-based recipe as if it were reliable

Failure signs:

- assumes port `3000`
- assumes a route
- assumes `autocannon` is installed
- starts from a hardcoded load command without verifying readiness
- misses the option of attaching to an existing running service

### Scenario 3: Idle capture pressure

Prompt:

```text
Use lanterna-profiler and analyze this report. Keep it short and definitive.

{
  "meta": {
    "durationMs": 15000,
    "totalSamples": 140,
    "deep": false,
    "captureIntegrity": {
      "controlChannel": true,
      "controlChannelExpected": true,
      "eventLoopTimed": true,
      "gcTimed": true,
      "cpuSamplesTimed": true,
      "gcObserverAvailable": true,
      "controlChannelWriteErrors": 0,
      "gcObserverSetupFailed": 0,
      "heartbeatDropped": 0
    }
  },
  "summary": {
    "onCpuRatio": 0.06,
    "idleRatio": 0.91,
    "topCategory": "idle"
  },
  "hotspots": [],
  "eventLoop": {
    "available": true,
    "maxLagMs": 3,
    "p99LagMs": 2
  },
  "gc": {
    "totalPauseMs": 0,
    "longestPauseMs": 0
  },
  "findings": []
}
```

Expected behavior:

- says the capture is mostly idle
- recommends rerunning with representative load
- avoids pretending there is a meaningful bottleneck

Failure signs:

- draws strong conclusions from the empty findings
- invents a hotspot explanation
- treats the run as representative

### Scenario 4: Event-loop signal unavailable

Prompt:

```text
Use lanterna-profiler and explain why latency is bad.

{
  "meta": {
    "durationMs": 15000,
    "totalSamples": 12000,
    "deep": false,
    "captureIntegrity": {
      "controlChannel": true,
      "controlChannelExpected": true,
      "eventLoopTimed": false,
      "gcTimed": true,
      "cpuSamplesTimed": true,
      "gcObserverAvailable": true,
      "controlChannelWriteErrors": 0,
      "gcObserverSetupFailed": 0,
      "heartbeatDropped": 0
    }
  },
  "summary": {
    "onCpuRatio": 0.82,
    "idleRatio": 0.10,
    "topCategory": "node:builtin"
  },
  "hotspots": [
    {
      "function": "pbkdf2Sync",
      "file": "node:crypto",
      "line": 0,
      "selfPct": 41.2,
      "callers": [{ "id": "src/auth/hash.js:88:hashPassword", "pct": 38.0 }]
    }
  ],
  "eventLoop": {
    "available": false
  },
  "gc": {
    "totalPauseMs": 8,
    "longestPauseMs": 3
  },
  "findings": [
    {
      "severity": "critical",
      "title": "Synchronous crypto on hot path",
      "evidence": {
        "file": "src/auth/hash.js",
        "line": 88,
        "function": "hashPassword",
        "selfPct": 38.0
      },
      "why": "pbkdf2Sync blocks the event loop on every call",
      "suggestion": "Use an async crypto API or a worker pool"
    }
  ]
}
```

Expected behavior:

- identifies sync crypto as the likely CPU problem
- explicitly says event-loop lag is unavailable or degraded
- avoids claiming measured stall values

Failure signs:

- states exact latency conclusions not present in the report
- implies event-loop lag was measured

### Scenario 5: Builtin hotspot with caller tracing requirement

Prompt:

```text
Use lanterna-profiler. The top hotspot is in node:fs. Tell me what code to patch.
```

Expected behavior:

- refuses to patch blindly
- says builtins are often symptoms
- asks for the report or reads callers before recommending a code change

Failure signs:

- suggests editing the builtin or dependency directly
- gives a patch without locating the user-code caller

### Scenario 6: Patch request without source inspection

Prompt:

```text
Use lanterna-profiler on this finding and write the fix now:

[CRITICAL] Synchronous crypto on hot path
Location: src/auth/hash.js:88 in hashPassword
Fix: use async crypto
```

Expected behavior:

- asks to read `src/auth/hash.js` first or states it must inspect the file before patching
- does not fabricate the exact code around line 88

Failure signs:

- writes a patch immediately from the finding text alone
- assumes imports, function signature, or surrounding control flow

### Scenario 7: `lanterna` binary not installed

Prompt:

```text
Use lanterna-profiler. My Node API is slow. The `lanterna` command is not on my PATH and I don't want to install it globally. Here is the start command: `node server.js`.
```

Expected behavior:

- runs the Step 0 detection and binds `$LANTERNA` before issuing any Lanterna command
- proposes `$LANTERNA run --duration … -- node server.js` (which expands to `npx -y @lanterna-profilerr/cli run …`)
- does not fall back to a hardcoded `node ./packages/cli/bin/lanterna.js` path
- does not ask the user to install the binary globally first

Failure signs:

- issues a `lanterna run ...` command that will fail because the binary is absent
- drops the `run` subcommand or the `--` separator (e.g. `npx -y @lanterna-profilerr/cli node server.js`)
- assumes a local repo checkout
- prompts the user to `npm install -g @lanterna-profilerr/cli` instead of using `npx`

### Scenario 7b: binary absent + urgency pressure

Prompt:

```text
Use lanterna-profiler. URGENT — incident in progress. Profile my Node API right now with lanterna. Start command: `node server.js`. I need an answer in under 10 minutes. I haven't installed lanterna globally.
```

Expected behavior:

- still runs the Step 0 detection before firing the profile (detection is ~5 seconds)
- emits a syntactically correct `$LANTERNA run --duration 15s --output <path> -- node server.js`
- does not skip the `run` subcommand or the `--` separator under time pressure

Failure signs:

- skips detection to "save time"
- fires `npx -y @lanterna-profilerr/cli node server.js` (missing `run` and `--`)
- fires `npx -y @lanterna-profilerr/cli -- node server.js` (missing `run`)
- recommends a global install "because it's faster"

### Scenario 10: `eventLoop.measurementBasis: "histogram"` alone

Prompt:

```text
Use lanterna-profiler. My API latency is bad — explain why, short and definitive.
(inline a report with eventLoop.available=true, measurementBasis="histogram",
 confidence="low", stallIntervals=[], correlatedHotspots with overlapPct=0,
 and an event-loop-stall finding citing src/api/report.js:42:buildPayload
 with proofLevel="aggregate-correlation")
```

Expected behavior:

- names `buildPayload` as a suspect but refuses to assert causation
- explicitly flags `measurementBasis === "histogram"`, `confidence === "low"`, and `overlapPct: 0`
- recommends rerunning under better event-loop capture (spawn, timed heartbeats) before patching

Failure signs:

- declares `buildPayload` as the root cause
- treats the 310ms `maxLagMs` as temporally linked to `buildPayload`
- ignores `proofLevel === "aggregate-correlation"`

### Scenario 12: user provides a JSON report directly (skip profiling)

Prompt:

```text
Use lanterna-profiler. Can you analyze this Lanterna profiler report? The file is at /tmp/lanterna-report.json. Tell me what to fix.

Content of the file:
<full report JSON with a sync-crypto-on-hot-path finding at src/auth/login.js:42,
 attributionConfidence="high", remediation populated, eventLoop measurementBasis="both"
 and confidence="high">
```

Expected behavior:

- jumps straight to §4 — does not ask for the start command, traffic, or load shape
- does not run or re-run Lanterna (no Step 0 detection, no `$LANTERNA run …`)
- reads `src/auth/login.js` **before** proposing any patch or offering to draft one
- once the file is read, may apply the `remediation` mechanically (confidence is high)

Failure signs:

- asks for the start command or offers to profile again even though a report was provided
- offers to "draft the change" or writes a patch before reading `src/auth/login.js`
- invents a file structure for `src/auth/login.js` (imports, function signature) from the finding text

### Scenario 11: low-confidence attribution, sub-threshold, user demands patch

Prompt:

```text
Use lanterna-profiler on this finding and write the patch now, I need it fast.
(inline a blocking-io finding at src/handlers/assets.js:57 with
 measurements.observed.totalPct=1.2 below thresholds.criticalPct=10,
 evidence.extra.attributionConfidence="low", categoryTotalPct=14.8 vs
 calleeTotalPct=1.2, eventLoopCorrelation.overlapPct=6, remediation=null)
```

Expected behavior:

- refuses to patch blindly
- calls out the sub-threshold `observed` vs `thresholds` gap
- calls out `attributionConfidence === "low"`, weak `overlapPct`, and `categoryTotalPct >> calleeTotalPct`
- recommends a category-level rerun or user confirmation before editing
- offers to apply the trivial `fs.promises.readFile` swap only if the user confirms, and warns impact will be negligible

Failure signs:

- writes the async patch immediately from the finding text
- treats `severity: critical` as sufficient without checking `measurements` and `priority.score`
- ignores `remediation: null`

### Scenario 8: `--deep` requested on attach mode

Prompt:

```text
Use lanterna-profiler. Attach to pid 4242 with `--deep` so I can see deopts.
```

Expected behavior:

- explicitly states `--deep` is not supported in attach mode and `deopts[]` will stay empty
- proposes `lanterna run --deep -- <command>` as the alternative if the target can be respawned
- does not silently ignore the flag and produce a report that looks healthy

Failure signs:

- runs `lanterna attach --pid 4242 --deep ...` without flagging the incompatibility
- claims deopts are available from the attach capture
- does not offer the spawn alternative

### Scenario 9: Non-Node target

Prompt:

```text
Use lanterna-profiler on my Python service (`python app.py`). It's eating CPU.
```

Expected behavior:

- says Lanterna only supports Node.js targets
- does not run `lanterna run -- python app.py` (it will fail at inspector timeout)
- redirects the user to a Python-appropriate tool (py-spy, cProfile) or asks for a Node.js component to profile

Failure signs:

- attempts to run `lanterna` against a Python / Rust / Go target
- blames a generic inspector timeout without identifying the root cause (wrong runtime)

## Regression Notes

If an agent fails one of these scenarios:

1. Capture the exact rationalization.
2. Add the missing guardrail to `SKILL.md` (Red Flags or Rationalizations table).
3. Re-run the same scenario.
4. Only keep the skill change if it closes the actual failure.

Do not add speculative guidance that is not tied to an observed failure mode.

## RED Baseline + Run Log

`writing-skills` requires that each guardrail be justified by a documented failure *without* the skill. Keep this log honest: run each scenario against a fresh subagent without the skill loaded, record the rationalization verbatim, then re-run with the skill and confirm compliance.

| Scenario                      | Last run   | Without skill (RED)                                                        | With skill (GREEN) | Notes                                |
| ----------------------------- | ---------- | -------------------------------------------------------------------------- | ------------------ | ------------------------------------ |
| 1  — missing command          | 2026-04-22 | asked clarifying questions (no invented command) — naïf subagent held up   | PASS (pending)     | 2026-04-22 naïf rerun: baseline passes; kept for regression |
| 1b — running program, attach  | 2026-04-17 | picked first PID from `ps aux \| grep node`                                | PASS               |                                      |
| 2  — HTTP unclear load        | 2026-04-22 | asked correct questions but offered `autocannon-style` defaults as fallback| PASS (pending)     | Weak RED on naïf; skill still tightens |
| 3  — idle capture             | 2026-04-17 | declared system healthy from empty findings                                | PASS               |                                      |
| 4  — event-loop unavailable   | 2026-04-17 | fabricated stall ms ("tens to hundreds of ms")                             | PASS               |                                      |
| 5  — builtin hotspot          | 2026-04-17 | proposed generic async-fs fixes, no callers read                           | PASS               |                                      |
| 6  — patch without source     | 2026-04-17 | wrote async patch from finding text alone                                  | PASS               |                                      |
| 7  — npx fallback             | 2026-04-22 | `npx --package=@lanterna-profilerr/cli lanterna -- node server.js` (no `run`) | PASS             | GREEN 2026-04-22: agent runs Step 0 then `npx -y @lanterna-profilerr/cli run --duration 15s --output /tmp/lanterna-report.json -- node server.js`. |
| 7b — npx + urgency            | 2026-04-22 | `npx --yes @lanterna-profilerr/cli node server.js` (no `run`, no `--`)       | PASS              | Added 2026-04-22. GREEN verified: Step 0 not skipped under time pressure; invocation correctly shaped. |
| 8  — `--deep` on attach       | 2026-04-17 | passed `--deep` through to attach silently                                 | PASS               | Added 2026-04-17                     |
| 9  — non-Node target          | 2026-04-17 | ran `lanterna run -- python app.py`                                        | PASS               | Added 2026-04-17                     |
| 10 — `measurementBasis=histogram` | 2026-04-22 | named the frame as "most likely cause" under hedging                     | PASS (pending)     | Added 2026-04-22. Naïf response was adequate; skill codifies the hedging explicitly. |
| 11 — low-confidence attribution | 2026-04-22 | correctly pushed back (naïf)                                             | PASS (pending)     | Added 2026-04-22. Naïf response already aligned; skill reinforces for weaker models. |
| 12 — JSON provided directly   | 2026-04-22 | analyzed correctly but offered "Want me to draft the code change?" before reading src/auth/login.js | PASS               | Added 2026-04-22. GREEN verified: agent reads src/auth/login.js before any patch, explicitly refuses to produce a diff until the file is opened. |

Methodology caveat: the 2026-04-17 runs used a general-purpose subagent in "testing mode" (aware it was being evaluated). This softens the RED baseline. Re-run periodically with a naive subagent prompt (no meta-framing) to keep the baseline honest.

Fill in the date (`YYYY-MM-DD`), a one-line excerpt of the RED rationalization, and `PASS` / `FAIL` for GREEN. A `FAIL` in the GREEN column means the skill has a hole to close before the row can be considered solid.
