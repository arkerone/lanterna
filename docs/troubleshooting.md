# Troubleshooting Lanterna

Common problems and how to resolve them.

> Field paths below use **schema v2**: CPU data lives under `profiles.cpu.*`. When a bare name like `summary.userCodeRatio` or `eventLoop.confidence` appears in this doc, it is short-hand for `profiles.cpu.summary.userCodeRatio` / `profiles.cpu.eventLoop.confidence` — the kind of thing you'd pass to `jq`.

## Quick triage

| Symptom | Jump to |
| --- | --- |
| `timed out waiting for inspector URL` on `run` | [Inspector timeout](#inspector-timeout) |
| `timed out waiting for inspector on pid ...` | [Attach by pid times out](#attach-by-pid-times-out) |
| `findings` / `profiles.cpu.hotspots` is `[]` | [Empty report](#empty-report) |
| `profiles.cpu.summary.userCodeRatio` near 0 | [Ratios look wrong](#ratios-look-wrong) |
| `captureIntegrity.*` flags are `false` | [Degraded capture integrity](#degraded-capture-integrity) |
| Unexpected `event-loop-stall` finding | [Spurious event-loop stall](#spurious-event-loop-stall) |
| Lots of V8 noise under `--deep` | [--deep noise](#--deep-noise) |
| Attach mode emits no deopts | [Attach mode has no deopts](#attach-mode-has-no-deopts) |
| Unknown `--kind <id>` | [Unknown profile kind](#unknown-profile-kind) |

---

## Inspector timeout

**Symptom:** Lanterna exits with `timed out waiting for inspector URL (5s). Is the target a node process?`

**Causes and fixes:**

1. **The target is not a Node.js process.** `lanterna run -- python app.py` will always fail. The `--` argument must be followed by a Node.js command.

2. **The process exits before the inspector starts.** If the target completes in under a millisecond (e.g. `node -e '1+1'`), it may exit before Lanterna can connect. Use the no-duration path so Lanterna captures the whole run:

   ```bash
   lanterna run -- node yourscript.js
   ```

3. **Inspector is disabled by environment.** Some Docker images, security policies, or Node.js custom builds disable the inspector flag. Try running the command directly with `--inspect=0` to confirm it works:

   ```bash
   node --inspect=0 -e 'setTimeout(()=>{},2000)'
   # Should print: Debugger listening on ws://...
   ```

4. **`NODE_OPTIONS` is pre-set to something conflicting.** Lanterna extends `NODE_OPTIONS`. If it already contains conflicting flags, the inspector may fail to start. Unset it before running:

   ```bash
   NODE_OPTIONS= lanterna run --duration 10s -- node app.js
   ```

---

## Attach by pid times out

**Symptom:** `lanterna attach --pid <pid>` exits with `timed out waiting for inspector on pid ...`.

**Causes and fixes:**

1. **The target is not a Node.js process.** `SIGUSR1` will not open a Node inspector on non-Node runtimes.

2. **The inspector cannot bind in the default local scan range.** `attach --pid` currently scans `127.0.0.1:9229..9238`. If another process owns that range, or the target uses a different inspector port, connect with `--inspect-url` instead.

3. **The environment disables `SIGUSR1`-based inspector startup.** Some process supervisors or hardened environments may block this path. Start the target with `--inspect` yourself and use:

   ```bash
   lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --duration 15s
   ```

4. **You are on Windows.** `attach --pid` is POSIX-oriented. On Windows, use `--inspect-url`.

---

## Empty report

**Symptom:** The report has no findings, or `hotspots` is an empty array.

**Causes and fixes:**

1. **Profiling window too short, or the process was idle.** Check `profiles.cpu.summary.idleRatio`. If it is above `0.8`, the process was mostly waiting. Either increase `--duration` or generate load against the process before running. (This matches the rerun threshold used by the `lanterna-profiler` skill.)

2. **The profiling window missed the hot code.** If your app has a startup phase that loads modules and then settles, the default window may land on idle steady state. Time the window to cover the actual load.

3. **Deopts not detected - missing `--deep`.** The `deopt-loop` detector only fires when `--deep` is passed, and only for functions also hot in the CPU profile. Without `--deep`, `deopts[]` is empty by design:

   ```bash
   lanterna run --deep --duration 30s -- node app.js
   ```

4. **GC findings suppressed on very short captures.** If `durationMs < 250` and no timed GC events were captured, the `excessive-gc` detector suppresses findings to avoid false positives. Run for longer.

---

## Ratios look wrong

**Symptom:** `summary.userCodeRatio` is very low (e.g. `0.01`) even though your code is clearly doing work.

**Causes and fixes:**

1. **The bottleneck is in native code, not user code.** Calls like `pbkdf2Sync` or `readFileSync` spend time in native C++ frames. Those appear as `native` or `node:builtin` in the summary, not `user`. This is expected - check `findings[]` for the relevant detector output.

2. **The process was mostly idle.** See [Empty report](#empty-report) above.

3. **The `cwd` differs from where your source files live.** Lanterna classifies frames as `user` based on whether the file path is inside `target.cwd`. If your app runs with a different cwd than where you ran Lanterna from, files may be classified as `node_modules` or `unknown`. Check `meta.cwd` in the report.

---

## Degraded capture integrity

**Symptom:** `meta.captureIntegrity.*` flags are `false`, or `eventLoop.confidence` is `"low"` or `"none"`.

**What each flag means when `false`:**

| Flag | Meaning |
| --- | --- |
| `controlChannel` | The preload hook's FD 3 pipe never sent events. GC and event-loop heartbeats are absent. |
| `eventLoopTimed` | No heartbeat events received. Event-loop measurements come from the histogram only. |
| `gcTimed` | GC events have no timestamps. GC-hotspot correlation is unavailable. |
| `kinds.cpu.samplesTimed` | `samples[]` and `timeDeltas[]` lengths differ. CPU stack correlation is approximate. (Under `meta.captureIntegrity.kinds.cpu`.) |

**What to do:**

- A fully degraded capture (`controlChannel: false` in spawn mode) can happen if the child closes FD 3 early. Some process managers (pm2, Docker entrypoints) close extra file descriptors. Try running the process directly.
- In **attach mode**, `controlChannel: false` is expected - judge quality from `eventLoopTimed`, `gcTimed`, `meta.captureIntegrity.kinds.cpu.samplesTimed`.
- On an interrupted attach capture, Lanterna prefers a partial report with degraded flags over hanging while waiting for late runtime reads.
- `eventLoopTimed: false` with `gcTimed: false` is normal for very short processes (< 200 ms) - measurements didn't have time to land.
- Always read `captureIntegrity` before drawing conclusions from correlation evidence.

---

## Spurious event-loop stall

**Symptom:** Lanterna reports `event-loop-stall` but you don't expect blocking code.

**Causes and fixes:**

1. **Low-confidence histogram measurement.** If `eventLoop.measurementBasis === "histogram"` and `confidence === "low"`, thresholds are already raised (p99 ≥ 200 ms, max ≥ 400 ms). Check `eventLoop.histogram` directly to assess whether the values are meaningful.

2. **One-off startup cost inflated the max.** The very first event-loop tick after module loading may be long. If `stallIntervals` shows a single stall near `atMs: 0`, it may be startup, not steady-state behavior.

3. **Heartbeats not available.** If `measurementBasis === "histogram"`, Lanterna cannot reconstruct which user-code frames ran during the stall window. `correlatedHotspots` in that case is based on overall CPU overlap, not temporal overlap.

---

## Unknown profile kind

**Symptom:** `lanterna run ... --kind <id>` or `lanterna attach ... --kind <id>` exits with:

```text
unknown profile kind(s): <ids>. Available kinds: cpu
```

**What it means:**

1. **Today `cpu` is the only built-in kind.** Both `run` and `attach` default to `--kind cpu` when you omit the flag.

2. **`--kind` accepts repeated flags and comma-separated shorthand.** These are equivalent:

   ```bash
   lanterna run --kind cpu -- node app.js
   lanterna run --kind cpu --kind memory -- node app.js
   lanterna run --kind cpu,memory -- node app.js
   ```

3. **An unknown kind is usually a typo or configuration error.** Double-check the id you passed on the CLI or in any wrapper script.

4. **It can also mean the kind was never registered.** If you expected a non-builtin kind, make sure the plugin or extension that registers it is actually loaded in this process.

**Fix:** Use `cpu` today, or load/register the extension that provides the extra kind before requesting it.

---

## `--deep` noise

> [!NOTE]
> **This is expected.** `--trace-deopt` tells V8 to print deoptimisation events. Lanterna captures those trace diagnostics for `deopts[]` and filters V8 trace lines out of JSON stdout; ordinary child stderr is still forwarded to your terminal. Redirect stderr if needed:
>
> ```bash
> lanterna run --deep --duration 30s -- node app.js 2>/dev/null
> ```

---

## Attach mode has no deopts

> [!NOTE]
> **This is expected.** `lanterna attach` does not support `--deep`, so `deopts[]` stays empty and no `deopt-loop:*` finding will be emitted. If you need deopt tracing, use `lanterna run --deep -- ...` so Lanterna starts the process with `--trace-deopt`.
