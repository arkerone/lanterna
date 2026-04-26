# LanternaReport Schema Reference

Use this for report navigation and multi-kind path conventions. For CPU-specific interpretation, see [cpu-profiling.md](cpu-profiling.md).

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
      }
    }
  }
}
```

Each section is only present when its kind appears in `meta.profileKinds`. CPU is the default; memory is opt-in via `--kind memory`. See [cpu-profiling.md](cpu-profiling.md) and [memory-profiling.md](memory-profiling.md) for per-kind interpretation.

Do not treat unknown profile sections as invalid; third-party kinds may add new report sections.

## `findings[]`

Findings are the primary agent-facing output and are sorted by action priority.

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
| `measurements.observed`, `measurements.thresholds` | Numeric trigger data |
| `priority.score`, `priority.actionConfidence` | Action ordering and confidence |
| `remediation` | Optional mechanical patch hints |

Rules:

- Read `evidence.file` before proposing code changes.
- Use `measurements` and `priority`, not severity alone.
- Unknown categories are extension findings, not schema violations.
- Treat missing optional fields as absent signal, not as zero.

## `extensions`

`extensions` is optional. It contains custom section analyzer output keyed by analyzer namespace. Kind-specific data should live under `profiles`, not `extensions`.
