# Troubleshooting

Symptom-keyed fixes for the most common Lanterna issues.

> Field paths use **schema v2**: CPU data lives under `profiles.cpu.*`, memory under `profiles.memory.*`, async under `profiles.async.*`. Bare names like `summary.userCodeRatio`, `quality.confidence`, or `eventLoop.confidence` are short-hand for the corresponding `profiles.cpu.*` path.

## Quick triage

| Symptom | Jump to |
| --- | --- |
| `timed out waiting for inspector URL` on `run` | [Inspector timeout](#inspector-timeout) |
| `timed out waiting ... for http://...` | [Readiness timeout](#readiness-timeout) |
| `workload failed with exit code ...` | [Workload failed](#workload-failed) |
| `timed out waiting for inspector on pid ...` | [Attach by pid times out](#attach-by-pid-times-out) |
| `findings` / `profiles.cpu.hotspots` is `[]` | [Empty CPU report](#empty-cpu-report) |
| `profiles.cpu.quality.confidence` is `"low"` | [Low-confidence CPU profile](#low-confidence-cpu-profile) |
| `profiles.cpu.summary.userCodeRatio` near 0 | [Ratios look wrong](#ratios-look-wrong) |
| `captureIntegrity.*` flags are `false` | [Degraded capture integrity](#degraded-capture-integrity) |
| Unexpected `event-loop-stall` finding | [Spurious event-loop stall](#spurious-event-loop-stall) |
| Lots of V8 noise under `--deep` | [`--deep` noise](#--deep-noise) |
| Attach mode emits no deopts | [Attach mode has no deopts](#attach-mode-has-no-deopts) |
| Unknown `--kind <id>` | [Unknown profile kind](#unknown-profile-kind) |
| `memory-growth:*` finding looks like a startup artifact | [Spurious memory-growth on warm-up](#spurious-memory-growth-on-warm-up) |
| `heapSnapshotAnalysis` empty or skipped | [Heap snapshot skipped or empty](#heap-snapshot-skipped-or-empty) |
| `--kind async` produces a near-empty report in attach | [Async report empty in attach mode](#async-report-empty-in-attach-mode) |
| `--async-instrumentation full` misses awaits | [Async full instrumentation misses sites](#async-full-instrumentation-misses-sites) |

---

## Inspector timeout

**Symptom:** Lanterna exits with `timed out waiting for inspector URL (5s). Is the target a node process?`

**Causes and fixes:**

1. **The target is not a Node.js process.** `lanterna run -- python app.py` will always fail. The `--` argument must be followed by a Node.js command.
2. **The process exits before the inspector starts.** If the target completes in under a millisecond (`node -e '1+1'`), it may exit before Lanterna can connect. Use the no-duration path so Lanterna captures the whole run:

   ```bash
   lanterna run -- node yourscript.js
   ```

3. **Inspector is disabled by environment.** Some Docker images, security policies or Node.js custom builds disable `--inspect`. Confirm it works directly:

   ```bash
   node --inspect=0 -e 'setTimeout(()=>{},2000)'
   # Should print: Debugger listening on ws://...
   ```

4. **`NODE_OPTIONS` is pre-set to something conflicting.** Lanterna extends `NODE_OPTIONS`. Unset it before running:

   ```bash
   NODE_OPTIONS= lanterna run --duration 10s -- node app.js
   ```

---

## Attach by pid times out

**Symptom:** `lanterna attach --pid <pid>` exits with `timed out waiting for inspector on pid ...`.

**Causes and fixes:**

1. **The target is not a Node.js process.** `SIGUSR1` will not open a Node inspector on non-Node runtimes.
2. **The inspector cannot bind in the default local scan range.** `attach --pid` scans `127.0.0.1:9229..9238`. If another process owns that range, or the target uses a different inspector port, connect with `--inspect-url`.
3. **The environment disables `SIGUSR1`-based inspector startup.** Some process supervisors or hardened environments block this path. Start the target with `--inspect` yourself and use:

   ```bash
   lanterna attach --inspect-url ws://127.0.0.1:9229/<uuid> --duration 15s
   ```

4. **You are on Windows.** `attach --pid` is POSIX-oriented. On Windows, use `--inspect-url`.

---

## Readiness timeout

**Symptom:** `lanterna run --wait-for-url ...` exits with `timed out waiting 30000ms for http://127.0.0.1:3000/health`.

**Causes and fixes:**

1. **The URL is wrong or bound to a different host/port.** Confirm it responds outside Lanterna:

   ```bash
   curl -i http://127.0.0.1:3000/health
   ```

2. **The app needs more time to start.** Increase the timeout: `--wait-timeout 60s`.
3. **The health endpoint requires state not present locally.** Use a simpler readiness endpoint or omit `--wait-for-url` and use `--capture-delay` only.
4. **The app starts but returns a non-2xx status.** Lanterna treats non-2xx as not ready. Fix the endpoint or point at one that returns success when the app is usable.

---

## Workload failed

**Symptom:** Lanterna writes the report and then exits with `workload failed with exit code ...` or a signal.

**What it means:** the profiled app may have captured useful evidence, but the external command passed to `--workload` failed. Inspect the report and the workload's own terminal output.

Common fixes:

1. **`npx` is waiting for an install confirmation.** Use `npx -y`.
2. **The workload starts before the server is ready.** Add `--wait-for-url`.
3. **The scenario itself failed.** Run the workload command directly from the same directory and fix its configuration, credentials, base URL, or fixture data.

---

## Empty CPU report

**Symptom:** the report has no findings, or `profiles.cpu.hotspots` is an empty array.

**Causes and fixes:**

1. **Profiling window too short, or the process was idle.** Check `profiles.cpu.quality.reasons[]`. Either increase `--duration` or generate load with `--workload`.
2. **The profiling window missed the hot code.** If your app has a startup phase that loads modules and then settles, the default window may land on idle steady state. Use `--wait-for-url` to skip startup, then generate traffic during capture.
3. **Deopts not detected — missing `--deep`.** The `deopt-loop` detector only fires when `--deep` is passed and only for functions also hot in the CPU profile. Without `--deep`, `deopts[]` is empty by design.
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
2. **Capture too short.** Capture several seconds of representative load instead of startup or idle time.
3. **High idle ratio.** Generate traffic against the target before and during the capture window.
4. **Untimed CPU samples.** Percentages remain useful, but `selfMs` / `totalMs` are interval-based estimates and temporal correlation is weaker.

Low confidence does not make the report useless — use it to choose what to inspect, but avoid claiming a root cause until a stronger rerun or source-level evidence corroborates it. See [signal-quality.md](./signal-quality.md).

---

## Ratios look wrong

**Symptom:** `summary.userCodeRatio` is very low (e.g. `0.01`) even though your code is clearly doing work.

**Causes and fixes:**

1. **The bottleneck is in native code, not user code.** Calls like `pbkdf2Sync` or `readFileSync` spend time in native C++ frames, classified as `native` or `node:builtin`. Expected — check `findings[]` for the relevant detector output.
2. **The process was mostly idle.** See [Empty CPU report](#empty-cpu-report).
3. **The `cwd` differs from where your source files live.** Lanterna classifies frames as `user` based on whether the file path is inside `target.cwd`. Check `meta.cwd` in the report.

---

## Degraded capture integrity

**Symptom:** `meta.captureIntegrity.*` flags are `false`, or `eventLoop.confidence` is `"low"` / `"none"`.

| Flag | Meaning when `false` |
| --- | --- |
| `controlChannel` | The preload's FD 3 channel never sent events. GC and event-loop heartbeats are absent. Expected in **attach mode**. |
| `eventLoopTimed` | No heartbeat events received. Event-loop measurements come from the histogram only. |
| `gcTimed` | GC events have no timestamps. GC-hotspot correlation is unavailable. |
| `kinds.cpu.samplesTimed` | `samples[]` and `timeDeltas[]` lengths differ. CPU stack correlation and hotspot ms are approximate. |

**What to do:**

- A fully degraded capture (`controlChannel: false` in spawn mode) can happen if the child closes FD 3 early. Some process managers (pm2, Docker entrypoints) close extra file descriptors. Try running the process directly.
- In **attach mode**, `controlChannel: false` is expected — judge quality from `eventLoopTimed`, `gcTimed`, `meta.captureIntegrity.kinds.cpu.samplesTimed`.
- Always read `profiles.cpu.quality` alongside; it folds these flags into user-facing `confidence` / `reasons[]` / `recommendations[]`.
- On an interrupted attach capture, Lanterna prefers a partial report with degraded flags over hanging while waiting for late runtime reads.
- `eventLoopTimed: false` with `gcTimed: false` is normal for very short processes (< 200 ms).

---

## Spurious event-loop stall

**Symptom:** Lanterna reports `event-loop-stall` but you don't expect blocking code.

**Causes and fixes:**

1. **Low-confidence histogram measurement.** If `eventLoop.measurementBasis === "histogram"` and `confidence === "low"`, thresholds are already raised (p99 ≥ 200 ms, max ≥ 400 ms). Check `eventLoop.histogram` directly.
2. **One-off startup cost inflated the max.** The very first event-loop tick after module loading may be long. If `stallIntervals` shows a single stall near `atMs: 0`, it may be startup, not steady-state behavior.
3. **Heartbeats not available.** When `measurementBasis === "histogram"`, Lanterna cannot reconstruct which user-code frames ran during the stall window. `correlatedHotspots` is then based on overall CPU overlap, not temporal overlap.

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

3. **Attach async capture is intentionally partial.** `lanterna attach --kind async ...` can observe only resources created after hooks are installed.
4. **An unknown kind is usually a typo.** Double-check the id.
5. **It can also mean the kind was never registered.** If you expected a non-builtin kind, make sure the plugin or extension that registers it is loaded — see [extending/plugin-loading.md](./extending/plugin-loading.md).

**Fix:** use one of `cpu`, `memory`, or experimental `async`, or load/register the extension that provides the extra kind before requesting it.

---

## `--deep` noise

> **This is expected.** `--trace-deopt` tells V8 to print deoptimisation events. Lanterna captures those trace diagnostics for `deopts[]` and filters V8 trace lines out of JSON stdout; ordinary child stderr is still forwarded to your terminal. Redirect stderr if needed:
>
> ```bash
> lanterna run --deep --duration 30s -- node app.js 2>/dev/null
> ```

---

## Attach mode has no deopts

> **This is expected.** `lanterna attach` does not support `--deep`, so `deopts[]` stays empty and no `deopt-loop:*` finding will be emitted. If you need deopt tracing, use `lanterna run --deep -- ...` so Lanterna starts the process with `--trace-deopt`.

---

## Spurious memory-growth on warm-up

**Symptom:** `memory-growth:rss` or `memory-growth:heapUsed` fires on a short capture that included module loading or cache warm-up.

**Causes and fixes:**

1. **The slope was computed across warm-up.** Module init, JIT warm-up, and connection pool seeding all allocate. The linear fit picks them up as growth. Use `--wait-for-url` and `--capture-delay` to start capture after warm-up:

   ```bash
   lanterna run --kind memory --wait-for-url http://127.0.0.1:3000/health --capture-delay 5s --duration 60s -- node server.js
   ```

2. **The capture was too short.** With < ~10 `memoryUsage` samples the slope is unreliable. Increase `--duration` or lower `--memory-usage-interval`.
3. **Confirm with a longer steady-state capture.** Treat a single warm-up `memory-growth:*` finding as a hypothesis, not proof. Rerun for several minutes under steady load and compare.

---

## Heap snapshot skipped or empty

**Symptom:** `profiles.memory.heapSnapshotAnalysis` is missing, empty, or has `skipped: true`.

**Causes and fixes:**

1. **You did not pass `--heap-snapshot-analysis`.** It's opt-in.
2. **The capture ended via `Ctrl+C`.** When `--heap-snapshot-analysis` is active, stopping early skips the final snapshot so Lanterna exits promptly. Use `--duration` or let the target exit naturally.
3. **The snapshot exceeded internal size limits.** Very large snapshots are skipped with a warning rather than parsed unbounded — `heapSnapshotAnalysis.skipped` is `true`. Reduce target heap usage or use `--heap-sample-interval` for a sampled view of allocations.
4. **Disk write failed.** Check `--heap-snapshot-dir` is writable and has space. Default is `.lanterna-heapsnapshots`.

---

## Async report empty in attach mode

**Symptom:** `lanterna attach --kind async ...` produces a `profiles.async.*` section with very few resources or chains.

> **This is the expected behavior.** Attach mode installs hooks **after** the target is already running. Resources and `await` sites loaded before installation are not observable. `quality.attachPartialCapture` is set to `true`; downgrade async findings accordingly.

If you need full async capture, use `lanterna run --kind async -- ...` so Lanterna installs the hook before user code runs.

---

## Async full instrumentation misses sites

**Symptom:** `--async-instrumentation full` is enabled but some `await` boundaries are still not captured.

**Causes and fixes:**

1. **The code was loaded before instrumentation registered.** `full` rewrites `await` sites in modules loaded **after** registration. Code loaded earlier is not covered. In attach mode this is fundamental; in spawn mode it can happen if the preload hook is itself loaded after some modules (rare).
2. **Source maps or bundlers interfere.** Bundled or transpiled code may not present recognisable `await` patterns to the rewriter. Run unbundled code where possible.
3. **`safe` mode is sufficient.** `full` is experimental and higher risk. Stick to `safe` unless `safe` cannot identify the await sites you need; check `profiles.async.quality.instrumentationFailures` for failed rewrites — the count is non-fatal but indicative.
