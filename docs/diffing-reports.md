# Diffing reports

`lanterna diff <baseline.json> <current.json>` compares two Lanterna JSON reports and emits a structured, agent-friendly diff. It answers the question a regression workflow actually has: *did this change make the profile worse, and where?*

This is on-thesis: the diff is finding-first (the product surface), not a visual comparison. It is built for CI gates and agents, with a `regressed` headline you can branch on.

## Usage

```bash
# Capture two reports (any mode that writes JSON)
lanterna run --duration 30s --output before.json -- node server.js
# ...make a change...
lanterna run --duration 30s --output after.json -- node server.js

# Compare them
lanterna diff before.json after.json                       # text
lanterna diff before.json after.json --format markdown      # for a PR
lanterna diff before.json after.json --format agent         # for an agent / CI
lanterna diff before.json after.json --format json --pretty # machine-readable
```

Both arguments are existing Lanterna reports produced with `--format json` (the default for `--output *.json`).

## What it compares

- **Findings, by `id`.** Each finding's id encodes its detector and location (e.g. `cpu-hotspot:<frame>`), so the diff is stable across runs:
  - **added** — findings present in current but not baseline.
  - **removed** — findings present in baseline but not current.
  - **changed** — same id, but `severity`, `confidence`, or rounded `priority.score` moved. Severity moves are tagged `worse` / `better` / `same`.
  - **unchanged** — same id, no change (reported as a count).
- **Headline metric deltas**, for kinds present in *both* reports:
  - CPU: `idle ratio`, `GC ratio`, `top culprit self%`.
  - Memory: `RSS slope (B/s)`, `heapUsed slope (B/s)`.
  Each delta is tagged `worse` / `better` / `same` using the metric's natural direction (e.g. a rising GC ratio or RSS slope is `worse`; more idle headroom is `better`).

## The `regressed` headline

`regressed` is `true` when the current report **introduces or worsens a non-info finding** — i.e. an added `warning`/`critical`, or an existing finding whose severity went up. It is the first thing the agent and JSON formats expose, so a CI step can gate on it:

```bash
lanterna diff before.json after.json --format json \
  | node -e 'process.exit(JSON.parse(require("fs").readFileSync(0)).regressed ? 1 : 0)'
```

In `--format agent`, it is the first frontmatter key:

```
---
regressed: true
baseline_findings: 5
current_findings: 7
added: 2
removed: 0
changed: 1
unchanged: 4
---
```

## Caveats

- The diff matches findings by `id`. If a hotspot moves to a different frame, it shows as one removed + one added rather than a single "moved" entry — that is intentional, since the location *is* part of the identity.
- Metric deltas are only computed for kinds captured in both reports. Diffing a `cpu` report against a `cpu,memory` report yields no memory deltas.
- `regressed` is a heuristic gate built on detector output. A `false` does not prove the change is safe — read the metric deltas and the unchanged findings too. See [reading-a-report.md](./reading-a-report.md).
- Comparing reports from different `mode`s (spawn vs attach) is allowed, but remember attach has documented capture limitations — a finding can "disappear" because attach could not observe it, not because it was fixed.
