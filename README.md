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

## What you get

- **Two capture modes** — `lanterna run` to spawn & profile a command, `lanterna attach` to connect to a live process via the inspector.
- **Three profile kinds** — opt in with `--kind`: `cpu` (V8 sampling profiler, default), `memory` (heap allocation profile + RSS series), and `async` (experimental async-resource profiling). Combine kinds by repeating `--kind` (`--kind cpu --kind memory`) or using commas (`--kind cpu,memory`).
- **Enriched `LanternaReport`** — categorized hotspots, hot stacks, GC pauses, event-loop lag, allocator ranking, async chains, capture-integrity flags.
- **Built-in detectors** for the patterns that actually matter — sync crypto / blocking I/O / JSON-on-hot-path, dependency hotspots, excessive GC, event-loop stalls, deopt loops, sustained memory growth, large allocators, off-heap pressure, deep async chains, long awaits, orphan resources, and more.
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

Per-kind details:

- **[docs/kinds/cpu.md](docs/kinds/cpu.md)** — CPU kind, hotspots, event loop, GC, deopts.
- **[docs/kinds/memory.md](docs/kinds/memory.md)** — memory kind, allocators, RSS series, heap snapshots.
- **[docs/kinds/async.md](docs/kinds/async.md)** — async kind (experimental), instrumentation modes, attach caveats.

Extending Lanterna:

- **[docs/extending/detectors.md](docs/extending/detectors.md)** — write a finding detector.
- **[docs/extending/profile-kinds.md](docs/extending/profile-kinds.md)** — write a brand-new profile kind.
- **[docs/extending/plugin-loading.md](docs/extending/plugin-loading.md)** — how plugins are discovered and packaged.

For agents (Claude Code skill):

- **[skills/lanterna-profiler/SKILL.md](skills/lanterna-profiler/SKILL.md)** — the agent-oriented profiling workflow.

Install the skill into an agent workspace with:

```bash
npx skills add arkerone/lanterna --skill lanterna-profiler
```

## Repository layout

```
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

## License

[MIT](LICENSE).
