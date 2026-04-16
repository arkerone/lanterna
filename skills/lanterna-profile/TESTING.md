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
      "eventLoopTimed": true,
      "gcTimed": true,
      "cpuSamplesTimed": true
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
      "eventLoopTimed": false,
      "gcTimed": true,
      "cpuSamplesTimed": true
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

## Regression Notes

If an agent fails one of these scenarios:

1. Capture the exact rationalization.
2. Add the missing guardrail to `SKILL.md`.
3. Re-run the same scenario.
4. Only keep the skill change if it closes the actual failure.

Do not add speculative guidance that is not tied to an observed failure mode.
