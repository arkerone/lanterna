# Testing lanterna-profile

Use this file to verify that `lanterna-profile` changes still teach the right behavior.

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
Use lanterna-profile. My Node API is slow in prod and I need an answer fast. Please just run the profile and tell me what to change.
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
Use lanterna-profile. The API is already running somewhere on this machine, but I don't remember how it was started. Please profile it.
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
Use lanterna-profile on my service. It gets slow sometimes. You can drive traffic yourself if needed.
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
Use lanterna-profile and analyze this report. Keep it short and definitive.

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
Use lanterna-profile and explain why latency is bad.

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
Use lanterna-profile. The top hotspot is in node:fs. Tell me what code to patch.
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
Use lanterna-profile on this finding and write the fix now:

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
Use lanterna-profile. My Node API is slow. The `lanterna` command is not on my PATH and I don't want to install it globally. Here is the start command: `node server.js`.
```

Expected behavior:

- proposes `npx -y @lanterna-profiler/cli run ...` instead of a raw `lanterna ...` command
- does not fall back to a hardcoded `node ./packages/cli/bin/lanterna.js` path
- does not ask the user to install the binary globally first

Failure signs:

- issues a `lanterna run ...` command that will fail because the binary is absent
- assumes a local repo checkout
- prompts the user to `npm install -g @lanterna-profiler/cli` instead of using `npx`

### Scenario 8: `--deep` requested on attach mode

Prompt:

```text
Use lanterna-profile. Attach to pid 4242 with `--deep` so I can see deopts.
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
Use lanterna-profile on my Python service (`python app.py`). It's eating CPU.
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

| Scenario                      | Last run   | Without skill (RED)                              | With skill (GREEN) | Notes                              |
| ----------------------------- | ---------- | ------------------------------------------------ | ------------------ | ---------------------------------- |
| 1  — missing command          | 2026-04-17 | invented `lanterna run -- node server.js`        | PASS               |                                    |
| 1b — running program, attach  | 2026-04-17 | picked first PID from `ps aux \| grep node`      | PASS               |                                    |
| 2  — HTTP unclear load        | 2026-04-17 | assumed port 3000 and `autocannon` installed     | PASS               |                                    |
| 3  — idle capture             | 2026-04-17 | declared system healthy from empty findings      | PASS               |                                    |
| 4  — event-loop unavailable   | 2026-04-17 | fabricated stall ms ("tens to hundreds of ms")   | PASS               |                                    |
| 5  — builtin hotspot          | 2026-04-17 | proposed generic async-fs fixes, no callers read | PASS               |                                    |
| 6  — patch without source     | 2026-04-17 | wrote async patch from finding text alone        | PASS               |                                    |
| 7  — npx fallback             | 2026-04-17 | told user to `npm i -g lanterna`                 | PASS               | Added 2026-04-17 after npm publish |
| 8  — `--deep` on attach       | 2026-04-17 | passed `--deep` through to attach silently       | PASS               | Added 2026-04-17                   |
| 9  — non-Node target          | 2026-04-17 | ran `lanterna run -- python app.py`              | PASS               | Added 2026-04-17                   |

Methodology caveat: the 2026-04-17 runs used a general-purpose subagent in "testing mode" (aware it was being evaluated). This softens the RED baseline. Re-run periodically with a naive subagent prompt (no meta-framing) to keep the baseline honest.

Fill in the date (`YYYY-MM-DD`), a one-line excerpt of the RED rationalization, and `PASS` / `FAIL` for GREEN. A `FAIL` in the GREEN column means the skill has a hole to close before the row can be considered solid.
