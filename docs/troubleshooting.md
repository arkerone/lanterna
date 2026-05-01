# Troubleshooting Lanterna

Common problems and how to resolve them.

> Field paths below use **schema v2**: CPU data lives under `profiles.cpu.*`. When a bare name like `summary.userCodeRatio`, `quality.confidence`, or `eventLoop.confidence` appears in this doc, it is short-hand for `profiles.cpu.summary.userCodeRatio` / `profiles.cpu.quality.confidence` / `profiles.cpu.eventLoop.confidence` — the kind of thing you'd pass to `jq`.

## Quick triage

| Symptom | Jump to |
| --- | --- |
| `timed out waiting for inspector URL` on `run` | [Inspector timeout](#inspector-timeout) |
| `timed out waiting ... for http://...` | [Readiness timeout](#readiness-timeout) |
| `workload failed with exit code ...` | [Workload failed](#workload-failed) |
| `timed out waiting for inspector on pid ...` | [Attach by pid times out](#attach-by-pid-times-out) |
| `findings` / `profiles.cpu.hotspots` is `[]` | [Empty report](#empty-report) |
| `profiles.cpu.quality.confidence` is `"low"` | [Low-confidence CPU profile](#low-confidence-cpu-profile) |
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

## Readiness timeout

**Symptom:** `lanterna run --wait-for-url ...` exits with a message like `timed out waiting 30000ms for http://127.0.0.1:3000/health`.

**Causes and fixes:**

1. **The URL is wrong or bound to a different host/port.** Confirm it responds outside Lanterna:

   ```bash
   curl -i http://127.0.0.1:3000/health
   ```

2. **The app needs more time to start.** Increase the timeout:

   ```bash
   lanterna run --wait-for-url http://127.0.0.1:3000/health --wait-timeout 60s -- node server.js
   ```

3. **The health endpoint requires state not present locally.** Use a simpler readiness endpoint or omit `--wait-for-url` and use `--capture-delay` only.

4. **The app starts but returns an error status.** Lanterna treats non-2xx responses as not ready. Fix the endpoint or point at a route that returns success when the app is usable.

---

## Workload failed

**Symptom:** Lanterna writes the report and then exits with `workload failed with exit code ...` or a signal.

**What it means:** The profiled app may have captured useful evidence, but the external command passed to `--workload` failed. Inspect the report and the workload's own terminal output.

Common fixes:

1. **`npx` is waiting for an install confirmation.** Use `npx -y`:

   ```bash
   lanterna run --workload "npx -y autocannon http://127.0.0.1:3000" -- node server.js
   ```

2. **The workload starts before the server is ready.** Add `--wait-for-url`:

   ```bash
   lanterna run --wait-for-url http://127.0.0.1:3000/health --workload "npx -y autocannon http://127.0.0.1:3000" -- node server.js
   ```

3. **The scenario itself failed.** Run the workload command directly from the same directory and fix its configuration, credentials, base URL, or fixture data.

---

## Empty report

**Symptom:** The report has no findings, or `hotspots` is an empty array.

**Causes and fixes:**

1. **Profiling window too short, or the process was idle.** Check `profiles.cpu.quality`. Its `reasons[]` should say whether the capture was too short, under-sampled, or mostly idle. Either increase `--duration` or generate load against the process with `--workload`.

2. **The profiling window missed the hot code.** If your app has a startup phase that loads modules and then settles, the default window may land on idle steady state. Use `--wait-for-url` to avoid profiling only startup, then generate traffic during the capture.

3. **Deopts not detected - missing `--deep`.** The `deopt-loop` detector only fires when `--deep` is passed, and only for functions also hot in the CPU profile. Without `--deep`, `deopts[]` is empty by design:

   ```bash
   lanterna run --deep --duration 30s -- node app.js
   ```

4. **GC findings suppressed on very short captures.** If `durationMs < 250` and no timed GC events were captured, the `excessive-gc` detector suppresses findings to avoid false positives. Run for longer.

---

## Low-confidence CPU profile

**Symptom:** `profiles.cpu.quality.confidence` is `"low"`.

**What to inspect:**

```bash
jq '.profiles.cpu.quality' report.json
```

Common reasons and fixes:

1. **Too few CPU samples.** Increase `--duration` or run the workload harder during capture.
2. **Capture too short.** For server routes, capture several seconds of representative load instead of startup or idle time.
3. **High idle ratio.** Generate traffic against the target before and during the capture window.
4. **Untimed CPU samples.** Percentages remain useful, but hotspot `selfMs` / `totalMs` are interval-based estimates and temporal correlation is weaker.

Low confidence does not make the report useless. Use it to choose what to inspect, but avoid claiming a root cause until a stronger rerun or source-level evidence corroborates it.

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
| `kinds.cpu.samplesTimed` | `samples[]` and `timeDeltas[]` lengths differ. CPU stack correlation and hotspot milliseconds are approximate. (Under `meta.captureIntegrity.kinds.cpu`.) |

**What to do:**

- A fully degraded capture (`controlChannel: false` in spawn mode) can happen if the child closes FD 3 early. Some process managers (pm2, Docker entrypoints) close extra file descriptors. Try running the process directly.
- In **attach mode**, `controlChannel: false` is expected - judge quality from `eventLoopTimed`, `gcTimed`, `meta.captureIntegrity.kinds.cpu.samplesTimed`.
- Also read `profiles.cpu.quality`; it folds these low-level signals into user-facing `confidence`, `reasons[]`, and `recommendations[]`.
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
unknown profile kind(s): <ids>. Available kinds: cpu, memory, async
```

**What it means:**

1. **Built-in kind ids are `cpu`, `memory`, and `async`.** Both `run` and `attach` default to `--kind cpu` when you omit the flag. `async` is experimental and must be selected explicitly.

2. **`--kind` accepts repeated flags and comma-separated shorthand.** These are equivalent:

   ```bash
   lanterna run --kind cpu -- node app.js
   lanterna run --kind cpu --kind memory -- node app.js
   lanterna run --kind cpu,memory -- node app.js
   lanterna run --kind async -- node app.js
   ```

3. **Attach async capture is intentionally partial.** `lanterna attach --kind async ...` can observe only resources created after hooks are installed; preexisting resources and already-loaded `await` sites are not fully observable.

4. **An unknown kind is usually a typo or configuration error.** Double-check the id you passed on the CLI or in any wrapper script.

5. **It can also mean the kind was never registered.** If you expected a non-builtin kind, make sure the plugin or extension that registers it is actually loaded in this process.

**Fix:** Use one of `cpu`, `memory`, or experimental `async`, or load/register the extension that provides the extra kind before requesting it.

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
