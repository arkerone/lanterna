# Reading a Lanterna Report

Lanterna emits a structured `LanternaReport` JSON object. This document explains how to read it in the right order, what each section means, and how to avoid common misinterpretations.

## Read It In This Order

For a first pass, use this sequence:

1. `meta`
2. `summary`
3. `findings`
4. `hotspots`
5. `eventLoop` and `gc`
6. `hotStacks`
7. `deopts`

That order gives you context before detail.

## `meta`: What Was Captured

`meta` answers basic questions about the session:

- which Node/V8 runtime was profiled
- which command was run
- how long the session lasted
- which sample interval was used
- whether `--deep` was enabled
- whether the capture paths worked as expected

Key fields:

- `durationMs`: wall-clock duration of the capture
- `sampleIntervalMicros`: V8 CPU sampling interval
- `command`: the executed command
- `mode`: currently always `spawn`
- `deep`: whether deopt tracing was enabled
- `captureIntegrity`: quality indicators for timed signals

How to use it:

- If `durationMs` is very short, treat ratios and rankings as less stable.
- If `captureIntegrity.controlChannel` is false, event-loop and GC timing likely degraded.
- If `deep` is false, ignore `deopts[]` entirely.

## `summary`: Where CPU Time Went

`summary` is the fastest way to understand the overall shape of the run.

Important fields:

- `onCpuRatio`: fraction of all samples where the process was actually doing work
- `userCodeRatio`: fraction of on-CPU time spent in user code
- `nodeModulesRatio`: fraction of on-CPU time in dependencies
- `builtinRatio`: fraction of on-CPU time in Node builtins
- `nativeRatio`: fraction of on-CPU time in V8/native frames
- `gcRatio`: fraction of on-CPU time spent in garbage collection
- `idleRatio`: fraction of all samples spent idle
- `topCategory`: dominant non-idle category
- `dominantBlockingKind`: coarse summary derived from emitted findings

Interpretation patterns:

- High `userCodeRatio`: your own code is where CPU is spent; hotspots are likely actionable directly.
- High `builtinRatio`: often a sync builtin such as crypto, fs, child process, or compression.
- High `nativeRatio`: the actual CPU work may sit below a JS wrapper; look at callers and findings, not just the hottest leaf.
- High `gcRatio`: memory churn is likely part of the problem.
- High `idleRatio`: the run may not represent the real hot path because the process was mostly waiting.

## `findings`: The Action Queue

`findings[]` is the main entry point when you want actionable output.

Each finding contains:

- `id`
- `severity`
- `category`
- `title`
- `evidence`
- `why`
- `suggestion`
- `references`

Read `findings[]` as prioritized hypotheses backed by the capture, not as generic lint rules.

### Evidence Attribution

The most useful part is usually `evidence`:

- `file`, `line`, `function`: where Lanterna believes the action should happen
- `selfPct`: CPU weight attributed to that evidence
- `extra`: detector-specific metadata

For some detectors, `evidence.file` and `evidence.function` may point to a user caller rather than the builtin callee. That is intentional.

Example:

- the hottest builtin may be `pbkdf2Sync`
- the actionable evidence may be your `hashPassword` function that called it

### Current Detector Meanings

#### `sync-crypto-on-hot-path`

Interpretation:

- your code is calling synchronous crypto work on the main thread
- the report usually attributes the evidence to the user caller when possible

Typical next step:

- switch to async crypto or move the work to worker threads

#### `blocking-io:<api>`

Interpretation:

- a synchronous fs, child-process, or zlib API is on the hot path

Typical next step:

- replace it with the async equivalent or restructure the work off the request path

#### `excessive-gc`

Interpretation:

- the process spent too much on-CPU time in GC, or a GC pause was long enough to matter

Typical next step:

- inspect the top user hotspots for allocation-heavy patterns

#### `event-loop-stall`

Interpretation:

- the main thread stopped servicing tasks for too long
- correlation candidates indicate which user hotspots overlapped the measured stall windows

Typical next step:

- inspect the top correlated user hotspot, then the hottest user function overall

#### `deopt-loop:<function>`

Interpretation:

- a hot function kept deoptimising under `--deep`

Typical next step:

- stabilize shapes and types, then reprofile

#### `require-in-hot-path`

Interpretation:

- module loading is happening during active work rather than once at startup

Typical next step:

- hoist the import or memoize the lazy load

## `hotspots`: Where CPU Is Actually Spent

`hotspots[]` aggregates functions by `(file, function, line)`.

Each hotspot includes:

- `selfMs` and `selfPct`: direct time in that function
- `totalMs` and `totalPct`: inclusive time, including children
- `callers`: who invoked it
- `callees`: what it invoked
- `category`
- `optimizationState`

How to read it:

- Use `selfPct` to find the hottest direct leaves.
- Use `totalPct` to find broad expensive paths where work may happen in descendants or native code.
- Use `callers[]` when a builtin or dependency is hot; the caller is often the real source fix.

Common pattern:

- `pbkdf2Sync` may have low user visibility as a builtin frame
- its caller in user code is where you change behavior

## `eventLoop`: Latency Signal

`eventLoop` tells you whether CPU pressure translated into event-loop delay.

Important fields:

- `available`
- `measurementBasis`
- `confidence`
- `maxLagMs`
- `p99LagMs`
- `p50LagMs`
- `meanLagMs`
- `stallIntervals`
- `correlatedHotspots`

How to interpret it:

- `available = false` means there is no usable event-loop signal for this run.
- `measurementBasis = both` is the strongest case.
- `heartbeats` or `histogram` alone are useful, but weaker.
- `stallIntervals` shows when the main thread stopped picking up work.
- `correlatedHotspots` ranks user hotspots whose sampled CPU overlapped those windows.

Do not overread correlation:

- correlation is strong evidence for investigation
- correlation is not proof that a single line alone explains the entire stall

If the top candidate has weak overlap or confidence is low, inspect the broader hotspot list too.

## `gc`: Allocation Pressure and Pauses

`gc` summarizes runtime pause activity:

- `totalPauseMs`
- `count`
- `longestPauseMs`
- `pausesOver10ms`
- `correlatedHotspots`

How to interpret it:

- frequent short pauses usually mean allocation churn
- a long `markSweep` pause usually means old-space pressure or retained memory
- correlated hotspots give you a ranked starting point for allocation analysis

What to inspect in code:

- repeated object churn in hot loops
- unbounded caches
- large `Buffer.concat` usage
- repeated `JSON.parse` and `JSON.stringify`

## `hotStacks`: Sampled Call Paths

`hotStacks[]` is useful when a single hotspot is not enough.

Each entry is a complete sampled stack with:

- `weightPct`
- `frames[]` from leaf to root

Use hot stacks when:

- multiple callers feed the same builtin
- a dependency hotspot could be triggered by several different routes
- you want the surrounding path without manually reconstructing it from callers/callees

## `deopts`: V8 JIT Instability

`deopts[]` is populated only when `meta.deep` is true.

Each entry groups repeated deoptimisations with:

- function
- file
- line
- reason
- bailout type
- count
- explanation

How to use it:

- focus on repeated entries, not one-off noise
- compare the deopted function to the hotspot list
- if a function is both hot and repeatedly deoptimised, it is usually worth fixing

## Common Reading Mistakes

### Mistake: treating `topCategory` as a diagnosis

`topCategory` is a summary, not a root cause. High `native` often just means the CPU work happened below JS wrappers.

### Mistake: assuming no findings means no problem

Lanterna only detects specific patterns. A clean `findings[]` can still hide a genuine user-code hotspot that no detector matches.

### Mistake: blaming `node_modules` immediately

A dependency hotspot is often just where the CPU landed. The caller path may still be your code.

### Mistake: ignoring `idleRatio`

A profile captured without real load can be technically valid but operationally misleading.

### Mistake: reading event-loop lag without reading confidence

Always read `measurementBasis` and `confidence` alongside lag numbers.

## What To Do After Reading a Report

Use this sequence:

1. act on critical findings first
2. inspect the top 5 hotspots even if they did not trigger a finding
3. if the run was mostly idle, rerun under representative load
4. if you suspect JIT instability, rerun with `--deep`
5. read the actual source file named in `evidence.file` before making changes

If you want to understand why the report exposes these fields and flags, read [how-lanterna-works.md](how-lanterna-works.md).
