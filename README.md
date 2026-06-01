<p align="center">
  <img src="assets/icon.png" alt="Lanterna" width="220" />
</p>

<h1 align="center">Lanterna</h1>

<p align="center">
  <strong>Agent-first Node.js CPU, memory & experimental async profiler.</strong><br />
  Spawns or attaches to your program, captures selected profile kinds plus timed runtime signals,<br />
  and emits a structured JSON report that humans <em>and</em> AI agents can act on directly.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lanterna-profiler/cli"><img src="https://img.shields.io/npm/v/@lanterna-profiler/cli.svg" alt="npm version" /></a>
  <a href="https://skills.sh/arkerone/lanterna"><img src="https://skills.sh/b/arkerone/lanterna" alt="skills.sh" /></a>
  <img src="https://img.shields.io/node/v/@lanterna-profiler/cli.svg" alt="Node.js version" />
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
</p>

---

> Lanterna is built so its output is **useful to an AI agent**, not just a human reader. Instead of a flamegraph, you get a categorized, correlated, and actionable `LanternaReport` — ready to pipe into an LLM or a CLI tool.

## Why Lanterna?

Most Node.js profilers were designed for a human staring at a flamegraph. That's a problem when an AI agent is doing the investigation: a flamegraph isn't parseable, hot stacks aren't categorized, and "what should I fix first?" requires a human to interpret the visual.

Lanterna takes a different stance:

- **Structured JSON, not pixels.** The `LanternaReport` is a stable schema — hotspots, allocators, async chains, GC pauses, event-loop lag, and findings — that an agent can read, correlate, and act on directly.
- **Detectors, not just data.** 19 built-in detectors emit categorized `findings` (sync crypto, blocking I/O, deopt loops, memory growth, orphan async resources, …) with `confidence` and `proofLevel` so consumers know when to trust a hypothesis vs. require corroboration.
- **CPU + memory + async in one capture.** Combine kinds in a single run; cross-kind detectors like `alloc-in-hot-path` and `hot-async-context` surface the highest-priority fixes (something flamegraph tools can't represent).
- **Spawn or attach.** Profile a CLI, a server under load, or a live production process — same report shape, same detector surface.

### Compared to other Node.js profilers

| Tool | Primary output | CPU | Memory | Async | Findings / detectors | Agent-friendly |
| --- | --- | :-: | :-: | :-: | :-: | :-: |
| **Lanterna** | Structured JSON (+ text/markdown/agent renderers) | ✅ | ✅ | ✅ (experimental) | ✅ 19 built-in, pluggable | ✅ |
| `node --prof` / `--cpu-prof` | V8 isolate log / `.cpuprofile` | ✅ | — | — | — | ⚠️ raw, post-processing required |
| [0x](https://github.com/davidmarkclements/0x) | HTML flamegraph | ✅ | — | — | — | ❌ |
| [Clinic.js](https://github.com/clinicjs/node-clinic) (Doctor / Flame / Bubbleprof) | HTML dashboards | ✅ | ⚠️ via Doctor | ⚠️ via Bubbleprof | ⚠️ heuristic recommendations | ❌ |
| Chrome DevTools (inspector) | Interactive UI | ✅ | ✅ | ⚠️ stack-only | — | ❌ |

When to reach for something else:
- **You want a flamegraph for human inspection.** 0x and Chrome DevTools are purpose-built for that.
- **You're already on Clinic.js's Doctor diagnostics workflow.** Clinic does well as a one-shot human triage.
- **You need raw V8 internals (deoptimization traces, ICs, etc.).** Use `--prof` and the V8 tooling directly.

Lanterna is the right fit when the consumer of the report is **an agent or an automated pipeline** that needs categorized signals, not pixels.

## What you get

- **Two capture modes** — `lanterna run` to spawn & profile a command, `lanterna attach` to connect to a live process via the inspector. `lanterna ps` lists live `node`/`nodejs` processes (table or JSON) when you need to find a PID first.
- **Three profile kinds** — opt in with `--kind`: `cpu` (V8 sampling profiler, default), `memory` (heap allocation profile + RSS series), and `async` (experimental async-resource profiling). Combine kinds by repeating `--kind` (`--kind cpu --kind memory`) or using commas (`--kind cpu,memory`).
- **Enriched `LanternaReport`** — categorized hotspots, hot stacks, GC pauses, event-loop lag, allocator ranking, async chains, capture-integrity flags.
- **19 built-in detectors** across CPU, memory, and async kinds, including 3 cross-kind detectors (`alloc-in-hot-path`, `hot-async-context`, `event-loop-blocked-async`) — see the [Built-in detectors](#built-in-detectors) section below.
- **Stable JSON schema** with finding `confidence` and `proofLevel` fields so consumers can distinguish direct sampled evidence from heuristics.
- **Extensible** — ship your own detectors and profile kinds as plugins.

## 60-second example

```bash
# Install
npm install -g @lanterna-profiler/cli
# or run without installing
npx -y @lanterna-profiler/cli --help

# Profile a CLI script for 30 s and read the report
lanterna run --duration 30s --output report.json -- node app.js
lanterna report report.json --format text
lanterna report report.json --format agent --output report.agent.md

# Profile a server with representative load
lanterna run \
  --duration 30s \
  --wait-for-url http://127.0.0.1:3000/health \
  --workload "npx -y autocannon http://127.0.0.1:3000" \
  --output report.json \
  -- node server.js

# Memory leak hunt with start/end heap snapshot
lanterna run --kind memory --heap-snapshot-analysis --duration 60s -- node app.js
```

`Ctrl+C` stops profiling early **and still emits a final report**.

## Built-in detectors

Lanterna ships 19 detectors out of the box, including 3 cross-kind detectors (`alloc-in-hot-path` for `cpu + memory`, `hot-async-context` and `event-loop-blocked-async` for `cpu + async`). Each emits a `Finding` in the report with `confidence` and `proofLevel` so consumers can distinguish direct sampled evidence from heuristics.

**CPU kind** (9)

| ID | What it flags |
| --- | --- |
| `sync-crypto-on-hot-path` | Synchronous `crypto` calls (`pbkdf2Sync`, `randomBytesSync`, …) dominating CPU |
| `blocking-io` | Synchronous `fs` / `zlib` / `dns` calls on hot stacks |
| `json-on-hot-path` | `JSON.parse` / `JSON.stringify` dominating CPU |
| `excessive-gc` | High GC pause time relative to wall time |
| `event-loop-stall` | Long event-loop lag spikes correlated with stack samples |
| `deopt-loop` | V8 deoptimisation cycles repeatedly hit on the same function |
| `require-in-hot-path` | Dynamic `require()` resolved on hot stacks (cold-start surprise) |
| `node-modules-hotspot` | A third-party dependency dominating CPU |
| `cpu-hotspot` | Generic fallback: hot user-code frames not explained by any other detector |

**Memory kind** (4)

| ID | What it flags |
| --- | --- |
| `memory-growth` | Sustained heap / RSS growth over the capture window |
| `large-allocator` | A single allocator responsible for a dominant share of bytes |
| `external-buffer-pressure` | Off-heap pressure (Buffers, ArrayBuffers) |
| `alloc-in-hot-path` | Allocators that are also CPU hot stacks — double impact, top-priority fix (cross-kind: requires both `cpu` and `memory`, auto-skips otherwise) |

**Async kind** (experimental, 6)

| ID | What it flags |
| --- | --- |
| `long-await` | `await` expressions exceeding the wait-time threshold |
| `orphan-async-resource` | Async resources created but never resolved / destroyed |
| `deep-async-chain` | Deeply nested await chains amplifying latency |
| `microtask-flood` | Microtask queue saturation starving the event loop |
| `hot-async-context` | Async contexts dominating CPU (cross-kind: requires both `cpu` and `async`, auto-skips otherwise) |
| `event-loop-blocked-async` | An async op's wait overlaps an event-loop stall — latency is a blocked loop, not slow I/O; anchored on the synchronous CPU frame (cross-kind: requires both `cpu` and `async`, auto-skips otherwise) |

Built-in thresholds are exported as `DETECTOR_THRESHOLDS` for detector authors — see [docs/extending/detectors.md](docs/extending/detectors.md#thresholds). `.lanterna.json` configures capture options and plugin loading; see [docs/configuration.md](docs/configuration.md). To ship your own detectors, see [docs/extending/detectors.md](docs/extending/detectors.md).

## Requirements

| Environment | Minimum | Why |
| --- | --- | --- |
| Node.js running Lanterna | `>= 22` | Active LTS lines (22, 24). |
| Node.js running the **profiled program** | `>= 12` | Needs `monitorEventLoopDelay` and `PerformanceObserver` GC entries. |

The profiled target must support the V8 inspector. If the inspector cannot start, Lanterna fails fast — it never silently falls back to a weaker mode.

## Packages

| Package | What it is |
| --- | --- |
| [`@lanterna-profiler/cli`](packages/cli) | The `lanterna` binary. |
| [`@lanterna-profiler/core`](packages/core) | Capture orchestration, profile kinds, analysis pipeline, report builder. |
| [`@lanterna-profiler/detectors`](packages/detectors) | Default detector pack for CPU, memory and async kinds, plus plugin helpers. |

## Documentation

Start here, then dive into whichever topic you need:

- **[docs/getting-started.md](docs/getting-started.md)** — install, first capture, reading the output.
- **[docs/cli.md](docs/cli.md)** — full CLI reference and option groups.
- **[docs/configuration.md](docs/configuration.md)** — `.lanterna.json` reference.
- **[docs/programmatic-api.md](docs/programmatic-api.md)** — `runProfile`, `attachProfile`, low-level capture and analysis APIs.
- **[docs/report-schema.md](docs/report-schema.md)** — `LanternaReport` shape (schema v2).
- **[docs/reading-a-report.md](docs/reading-a-report.md)** — interpretation playbook and common mistakes.
- **[docs/signal-quality.md](docs/signal-quality.md)** — confidence, integrity flags, degradation modes.
- **[docs/architecture.md](docs/architecture.md)** — capture flow and enrichment pipeline.
- **[docs/troubleshooting.md](docs/troubleshooting.md)** — symptom-keyed fixes.
- **[docs/performance-overhead.md](docs/performance-overhead.md)** — measured startup cost and steady-state overhead per kind.

Per-kind details:

- **[docs/kinds/cpu.md](docs/kinds/cpu.md)** — CPU kind, hotspots, event loop, GC, deopts.
- **[docs/kinds/memory.md](docs/kinds/memory.md)** — memory kind, allocators, RSS series, heap snapshots.
- **[docs/kinds/async.md](docs/kinds/async.md)** — async kind (experimental), instrumentation modes, attach caveats.

Extending Lanterna:

- **[docs/extending/detectors.md](docs/extending/detectors.md)** — write a finding detector.
- **[docs/extending/profile-kinds.md](docs/extending/profile-kinds.md)** — write a brand-new profile kind.
- **[docs/extending/plugin-loading.md](docs/extending/plugin-loading.md)** — how plugins are discovered and packaged.

Runnable examples:

- **[examples/](examples)** — a standalone workload for every built-in detector (one pathology each), plus a realistic HTTP server with several at once. Together they cover all 19 findings and double as an end-to-end verification suite (`npm run test:e2e`).

For agents (Claude Code skill):

- **[skills/lanterna-profiler/SKILL.md](skills/lanterna-profiler/SKILL.md)** — the agent-oriented profiling workflow.

Install the skill into an agent workspace with:

```bash
npx skills add arkerone/lanterna --skill lanterna-profiler
```

## Repository layout

```text
packages/
  core/       @lanterna-profiler/core       — capture orchestration, kinds, pipeline, report
  detectors/  @lanterna-profiler/detectors  — default detector pack (CPU + memory + async) and plugin helpers
  cli/        @lanterna-profiler/cli        — `lanterna` binary
docs/                                       — human documentation
skills/lanterna-profiler/                   — agent workflow for Claude Code
```

Dependency direction: `cli → core`, `cli → detectors`, `detectors → core`. `core` never imports `detectors`.

## Development

```bash
npm install
npm run build       # builds all three packages
npm test            # runs every package's vitest suite
```

Per-package work: `npm run build -w @lanterna-profiler/core`, `npm test -w @lanterna-profiler/cli`, etc.

Tests use Vitest and cover frame classification, hotspot aggregation, detector evidence attribution, and live profiling paths — including short-lived processes and real event-loop stall correlation.

## Changelog

Each package ships its own changelog, generated by [Changesets](https://github.com/changesets/changesets):

- [`packages/cli/CHANGELOG.md`](packages/cli/CHANGELOG.md)
- [`packages/core/CHANGELOG.md`](packages/core/CHANGELOG.md)
- [`packages/detectors/CHANGELOG.md`](packages/detectors/CHANGELOG.md)

## License

[MIT](LICENSE).
