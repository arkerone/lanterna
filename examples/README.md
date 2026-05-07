# Lanterna examples

Tiny standalone Node scripts that exhibit common performance pathologies. Each example is fully self-contained — no `npm install`, no helper deps. Run them directly with `npx -y @lanterna-profiler/cli` and inspect the report.

| Example | Pathology | Detectors that fire |
| --- | --- | --- |
| [cpu-hotspot](./cpu-hotspot) | Synchronous `pbkdf2Sync` on a tight loop | `sync-crypto-on-hot-path` |
| [memory-leak](./memory-leak) | Unbounded `Map` + closure retainer | `memory-growth`, `large-allocator`, optional heap snapshot retainers |
| [event-loop-stall](./event-loop-stall) | `readFileSync` on a `setInterval` tick | `blocking-io`, `event-loop-stall` |

## Quick start

```bash
cd examples/cpu-hotspot
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

For agent-friendly output:

```bash
npx -y @lanterna-profiler/cli report report.json --format agent --output report.agent.md
```

Each example's `README.md` explains the expected findings and a one-line fix to confirm the detection works.
