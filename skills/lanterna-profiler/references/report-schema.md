# LanternaReport Schema Reference

Use this only for targeted JSON field lookup after reading the agent report. The agent report drives the interactive investigation; this schema is a fallback when a specific field is needed and not rendered. For CPU-specific interpretation, see [cpu-profiling.md](cpu-profiling.md).

For agent analysis, capture in JSON (`--format json --output report.json`), then render the agent contract with `$LANTERNA report report.json --format agent --output report.agent.md` (set `$LANTERNA` per the SKILL prefix block), and read that output in skill order. Do not start with `--format text`, `--format markdown`, or raw JSON. The JSON paths below are a schema dictionary for targeted clarification only when the agent report omits a field you need. The agent format renders the contract sections: frontmatter with `rerun_required`, `## Findings` table, `## Finding N` blocks, `Findings.decision` column, `Kind Review`, and `Files To Read First`.

## Top-Level Shape

```json
{
  "meta": { "...": "..." },
  "profiles": {
    "<reportSectionKey>": { "...": "..." }
  },
  "findings": [],
  "extensions": {}
}
```

- `meta`: capture metadata, kind list, mode, command, and integrity flags.
- `profiles`: per-kind report sections keyed by `ProfileKind.reportSectionKey`.
- `findings`: cross-kind findings; each finding carries `profileKind`.
- `extensions`: optional custom section-analyzer output.

## Kind Identity vs Report Section

- `ProfileKind.id` identifies the kind for CLI selection, capture data, `meta.kinds.<kindId>`, and `meta.captureIntegrity.kinds.<kindId>`. When that kind produces capture data, the id also appears in `meta.profileKinds[]`.
- `ProfileKind.reportSectionKey` identifies the key under `report.profiles`.
- Built-in CPU uses `cpu` for both.
- Custom kinds may use different values, so do not assume `kind.id === reportSectionKey`.

Example:

```json
{
  "meta": {
    "profileKinds": ["custom-kind"],
    "kinds": {
      "custom-kind": { "sampleCount": 42 }
    }
  },
  "profiles": {
    "custom_report": { "summary": {} }
  }
}
```

## `meta`

Common fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Report schema version |
| `nodeVersion`, `v8Version`, `platform`, `arch` | Target runtime metadata |
| `pid`, `cwd`, `startedAt`, `durationMs` | Capture context |
| `command` | Spawned command, or `[]` in attach mode |
| `mode` | `"spawn"`, `"attach"`, or `"in-process"` |
| `profileKinds` | Ordered kind ids that successfully produced capture data |
| `kinds` | Per-kind metadata keyed by kind id |
| `captureIntegrity` | Global and per-kind capture quality indicators |

Important global integrity flags:

| Flag | Meaning when degraded |
|---|---|
| `controlChannel` | Spawn preload could not send control-channel events |
| `controlChannelExpected` | Whether a control channel should have existed |
| `eventLoopTimed` | Event-loop timing fell back or was unavailable |
| `gcTimed` | GC events have degraded timestamps |
| `gcObserverAvailable` | Runtime GC observer was unavailable |
| `controlChannelWriteErrors`, `gcObserverSetupFailed`, `heartbeatDropped` | Non-zero counters reduce confidence |
| `diagnostics[]` | Non-fatal capture, probe, or analyzer diagnostics |
| `sourceMaps` | Source-map resolution counters: `{ enabled, framesResolved, framesUnresolved, coverage, mapsLoaded, failures: [{url, reason}] }`. When `enabled` and `coverage < 0.7`, treat any `source.*` position as a hint, not a fact. Capped at 20 `failures`. |

### `SourceLocation`

Optional field on every frame-bearing object (`hotspots[]`, `summary.topUserHotspot`, `hotStacks[].frames[]`, `hotStackClusters[].anchor`, `hotAllocators[]`, async frame-bearing entries such as `topOperations[]` / `chains[]` / `orphans[]`, `findings[].evidence`):

```json
{ "file": "src/server.ts", "line": 42, "column": 18, "name": "handleRequest" }
```

- `file` — relative to capture cwd when on disk; otherwise the raw map source URL (`webpack://app/src/...`, `vite:/src/...`).
- `line` — 1-based.
- `column` — 1-based, optional.
- `name` — original symbol name from the map's `names` array, useful when the generated `function` is `(anonymous)`.

**Reading rule:** use the agent report's rendered location first. It prefers `source.file:source.line` and keeps the generated fallback in parentheses. When consulting JSON for a missing field, apply the same rule. Treat virtual source paths such as `webpack://...` and `vite:/...` as bundler labels unless they resolve on disk.

### `userCaller`

`userCaller` points to the closest user-code frame associated with an otherwise external or indirect hot frame. It can appear on:

- `profiles.cpu.hotspots[].userCaller`
- `profiles.memory.hotAllocators[].userCaller`
- `profiles.memory.summary.topAllocator.userCaller`
- `profiles.async.topOperations[].userCaller`
- `profiles.async.hotFiles[].userCaller`
- `profiles.async.cpuAttribution.topChains[].userCaller`
- `profiles.async.summary.topAsyncHotFile.userCaller`
- `findings[].evidence.extra.userCaller`

Shape:

```json
{
  "function": "handleRequest",
  "file": "/repo/dist/app.js",
  "line": 22,
  "source": { "file": "src/app.ts", "line": 44 },
  "profilePct": 37.5,
  "supportPct": 92,
  "confidence": "high",
  "basis": "cpu-sample-path"
}
```

Location rule: use the agent report's rendered `User caller` first. If targeted JSON lookup is needed, prefer `userCaller.source.file:userCaller.source.line`, then keep `userCaller.file:userCaller.line` as generated fallback. `confidence: "high"` can support an actionable finding when the finding confidence, proof level, action confidence, and signal gate also support action. `confidence: "medium"` or `"low"` is only an inspection lead.

## `profiles`

`profiles` is a map of report section key to kind-specific data. The schema is composed from the active kinds. Built-in kinds:

```json
{
  "profiles": {
    "cpu": {
      "summary": {},
      "hotspots": [],
      "hotStacks": [],
      "gc": {},
      "eventLoop": {},
      "quality": {
        "confidence": "high",
        "sampleCount": 1200,
        "durationMs": 5000,
        "idleRatio": 0.2,
        "samplesTimed": true,
        "durationBasis": "timeDeltas",
        "reasons": [],
        "recommendations": []
      },
      "deopts": []
    },
    "memory": {
      "summary": {
        "totalSampledBytes": 0,
        "samplingIntervalBytes": 524288,
        "rss": { "startBytes": 0, "endBytes": 0, "minBytes": 0, "maxBytes": 0, "meanBytes": 0, "p95Bytes": 0, "slopeBytesPerSec": 0 },
        "heapUsed": {},
        "external": {},
        "arrayBuffers": {},
        "topAllocator": {},
        "externalRatio": 0
      },
      "hotAllocators": [],
      "memoryUsage": {
        "available": true,
        "sampleIntervalMs": 250,
        "sampleCount": 12,
        "firstSample": { "atMs": 0, "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 },
        "lastSample": { "atMs": 2750, "rss": 0, "heapTotal": 0, "heapUsed": 0, "external": 0, "arrayBuffers": 0 }
      },
      "heapSnapshotAnalysis": {
        "available": true,
        "mode": "start-end",
        "start": { "path": "/tmp/lanterna-heaps/start.heapsnapshot" },
        "end": { "path": "/tmp/lanterna-heaps/end.heapsnapshot" },
        "summary": {
          "totalRetainedGrowthBytes": 0,
          "topGrowingConstructor": "Map"
        },
        "growthByConstructor": [],
        "retainerPaths": [],
        "warnings": []
      }
    }
  }
}
```

Each section is only present when its kind appears in `meta.profileKinds`. CPU is the default; memory is opt-in via `--kind memory`; async is experimental and opt-in via `--kind async`. `profiles.memory.heapSnapshotAnalysis` is further opt-in via `--heap-snapshot-analysis`; when present, it may be `available: false` with explanatory `warnings[]` while the rest of the memory report remains valid. See [cpu-profiling.md](cpu-profiling.md), [memory-profiling.md](memory-profiling.md), and [async-profiling.md](async-profiling.md) for per-kind interpretation.

Do not treat unknown profile sections as invalid; third-party kinds may add new report sections.

## `findings[]`

Findings are rendered in the `## Findings` table and are sorted by action priority.

Common fields:

| Field | Meaning |
|---|---|
| `id` | Detector identifier |
| `profileKind` | Kind id that emitted or owns the finding |
| `severity` | `"info"`, `"warning"`, or `"critical"` |
| `category` | Finding family |
| `title`, `why`, `suggestion` | Human-readable explanation |
| `evidence.file`, `evidence.line`, `evidence.function` | Source location to inspect first |
| `evidence.selfPct` | CPU share or kind-specific share represented by the evidence |
| `evidence.extra` | Detector-specific proof, attribution, and correlation details |
| `evidence.extra.userCaller` | Optional nearest user-code caller attribution for external or indirect evidence |
| `measurements.observed`, `measurements.thresholds` | Numeric trigger data |
| `confidence` | Finding-level confidence: `"low"`, `"medium"`, or `"high"` when supplied |
| `proofLevel` | Evidence class: `"direct-sample"`, `"correlated-window"`, `"trace-only"`, or `"heuristic"` when supplied |
| `priority.score`, `priority.actionConfidence` | Action ordering and confidence |
| `remediation` | Optional mechanical patch hints |

Rules:

- Read the agent report's `Source` and `Generated fallback` before proposing code changes.
- In agent reports, `## Findings` table may include `User caller: <fn> (<location>) [confidence, support X%]`. Use that location before dependency/runtime frames, but only treat high-confidence user callers as potentially actionable.
- `Files To Read First` is a table of `location`, `reason`, `source`, `signal`, and `decision`. It excludes `node_modules`, `node:`, pnpm store, virtual source-map paths, pseudo-files, and runtime locations unless an editable user-code `userCaller` location is available. Generated output folders such as `dist/`, `build/`, `out/`, `.next/`, `.nuxt/`, `.svelte-kit/`, `.vite/`, and `coverage/` are rendered as `generated output fallback` with `decision = inspect-lead`, not `read-first`. Treat `read-first` as the source-reading queue, `inspect-lead` as a confirmation lead, and `supporting-context` as surrounding evidence. Reasons distinguish finding locations, dependency callers, runtime callers, CPU hotspots/stacks, memory allocators, and async leads such as `top async hot file`, `long async operation`, and `async CPU attribution`.
- Use `confidence`, `proofLevel`, `measurements`, and `priority`, not severity alone.
- Use `confidence`, `proofLevel`, `priority.actionConfidence`, `sourceMaps.coverage`, and `userCaller.confidence` together: high can be actionable; medium/low user callers are inspection leads; missing or unknown proof with non-high confidence means rerun.
- Unknown categories are extension findings, not schema violations.
- Treat missing optional fields as absent signal, not as zero.

## CPU Quality

The report frontmatter is the first place to check before drawing conclusions from CPU data. Use `profiles.cpu.quality` only as the targeted JSON path behind that rendered gate.

| Field | Meaning |
|---|---|
| `confidence` | Overall CPU-profile confidence: `high`, `medium`, or `low` |
| `sampleCount` | CPU samples used for hotspot and ratio analysis |
| `durationMs` | Capture duration used for quality scoring |
| `idleRatio` | Same ratio as `profiles.cpu.summary.idleRatio`, included for quick triage |
| `samplesTimed` | Whether CPU samples have usable per-sample timing |
| `durationBasis` | `timeDeltas` when hotspot milliseconds use V8 timing; otherwise `sampleInterval` |
| `reasons[]` | Why confidence was degraded |
| `recommendations[]` | How to rerun or interpret the report more safely |

Rules:

- If `confidence === "low"`, lead with the caveat and avoid definitive root-cause claims.
- Trust percentages before milliseconds when `durationBasis === "sampleInterval"`.
- If `reasons[]` mentions idleness or low samples, recommend a longer capture under representative load.

## `extensions`

`extensions` is optional. It contains custom section analyzer output keyed by analyzer namespace. Kind-specific data should live under `profiles`, not `extensions`.
