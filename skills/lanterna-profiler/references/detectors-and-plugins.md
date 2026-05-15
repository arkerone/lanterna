# Detectors And Plugins Reference

Use this when adding Lanterna detectors, authoring plugins, or wiring programmatic profiling.

## Package Boundary

- `@lanterna-profiler/core`: orchestration, capture, reports, profile kinds, `runProfile`, `attachProfile`, `createKindRegistry`, `KindScopedDetector`, and `createFindingAnalyzerFromKindScopedDetector`.
- `@lanterna-profiler/detectors`: built-in CPU detector pack, `createCpuProfileKindWithBuiltInDetectors`, `withBuiltInCpuDetectors`, thresholds, and attribution helpers.
- `@lanterna-profiler/cli`: command parsing, output, attach picker, plugin loading.

Do not import `runProfile`, `attachProfile`, or `createKindRegistry` from `@lanterna-profiler/detectors`. Do not assume detector helpers own capture orchestration.

## Programmatic CPU Profiling

```ts
import { runProfile } from '@lanterna-profiler/core';
import { createCpuProfileKindWithBuiltInDetectors } from '@lanterna-profiler/detectors';

let diagnostics = '';
const report = await runProfile({
  command: ['node', 'app.js'],
  durationMs: 15_000,
  pretty: true,
  onTargetDiagnosticChunk: (chunk) => {
    diagnostics += chunk;
  },
  kinds: [
    createCpuProfileKindWithBuiltInDetectors({
      readStderrSoFar: () => diagnostics,
      sampleIntervalMicros: 1000,
      deep: true,
    }),
  ],
});
```

If `deep: true`, append target diagnostics through `onTargetDiagnosticChunk` and return that buffer from `readStderrSoFar`. Use `deep: false` and return an empty string when diagnostics are not collected.

## Kind-Scoped Detectors

Use `KindScopedDetector<K>` when a detector reads one or more profile kinds. The adapter guards on `kindIds`, resolves each kind's report section through its registered `ProfileKind.reportSectionKey`, passes `{ report, view }`, and auto-tags findings with the primary kind when `profileKind` is unset.

```ts
import {
  createFindingAnalyzerFromKindScopedDetector,
  type KindScopedDetector,
} from '@lanterna-profiler/core';

const detector: KindScopedDetector<'cpu'> = {
  id: 'my-rule',
  kindIds: ['cpu'],
  detect({ cpu }) {
    return [
      {
        id: 'my-rule',
        profileKind: 'cpu',
        severity: 'info',
        category: 'custom',
        title: 'Custom finding',
        confidence: 'medium',
        proofLevel: 'heuristic',
        evidence: {
          file: 'src/app.js',
          line: 1,
          function: 'handler',
          selfPct: 0,
        },
        why: 'Explain the captured symptom.',
        suggestion: 'Suggest the next action.',
        references: [],
      },
    ];
  },
};

pipeline.register(createFindingAnalyzerFromKindScopedDetector(detector));
```

Use top-level `confidence` and `proofLevel` when the detector can characterize its evidence:

| `proofLevel` | Use for |
|---|---|
| `direct-sample` | A sampled CPU/heap frame directly supports the finding. |
| `correlated-window` | Timed windows or cross-signal correlation support the finding. |
| `trace-only` | Diagnostic trace output supports the finding, usually requiring corroboration. |
| `heuristic` | Derived trend or threshold evidence that should be treated as a lead. |

Set `confidence` to `high`, `medium`, or `low` based on sample volume, attribution strength, and whether the detector points to a direct edit location.

Finding analyzers run incrementally: after each analyzer completes, the in-progress `snapshot.findings` contains findings emitted so far. Later detectors can use that shared state to avoid duplicates or defer to stronger evidence. The built-in `cpu-hotspot` detector relies on this to suppress generic CPU findings when `sync-crypto`, `blocking-io`, `json-on-hot-path`, `node-modules-hotspot`, or `require-in-hot-path` already explains the frame.

## Built-In CPU Fallback

`cpu-hotspot:<frame>` is the generic CPU detector for plain user-code hotspots. It emits when a user frame crosses the configured self/inclusive CPU gates and no more specific CPU detector has already claimed it. Use `evidence.extra.mode` to interpret it: `self` is a direct body hotspot for custom loops, scoring functions, transformations, parsers, and other CPU-bound code; `inclusive-entry` is a caller/context lead for downstream CPU that still needs callees or hot stacks.

The threshold block is `DETECTOR_THRESHOLDS.cpuHotspot`:

- `minSelfPct`: self-heavy user-code gate.
- `minTotalPct`: inclusive fallback when no self-heavy candidate exists; emits `mode: "inclusive-entry"` and top-level `proofLevel: "heuristic"`.
- `criticalPct`: severity escalation.
- `maxFindings`: cap to avoid noisy generic output.

`event-loop-stall` also has two evidence modes in `evidence.extra.proofLevel`: `aggregate-correlation` for strong stall-window attribution, and `hotspot-fallback` when the event-loop lag is real but the source location is only the hottest user CPU lead.

## Multi-Kind Contract

- `ProfileKind.id`: CLI/runtime identity and `meta.kinds.<kindId>`; it appears in `meta.profileKinds[]` only when capture data was produced.
- `ProfileKind.reportSectionKey`: report namespace under `profiles.<reportSectionKey>`.
- These are usually equal, but custom kinds may differ.
- `KindScopedDetector.kindIds` refers to kind ids, not report section keys.
- Dynamic report schema comes from the active kinds' `reportSchema`.

## CLI Plugins

Plugins are ES modules loaded with `--detectors <spec>` or from `.lanterna.json` / `.lanterna.config.json`.

A plugin may export:

- `default`: a `LanternaDetectorPlugin` that registers pipeline-level analyzers;
- `kinds`: `ProfileKind[]` registered before `--kind <id>` is resolved.

Use `kinds` when a plugin ships a new profile kind or a kind pre-wired with built-in detectors. Use the default export for cross-cutting analyzers or extra rules.

CLI examples (still capture in JSON, then render the agent contract; set `$LANTERNA` per the SKILL prefix block):

```bash
LANTERNA="$(command -v lanterna >/dev/null 2>&1 && echo lanterna || echo 'npx -y @lanterna-profiler/cli')"
$LANTERNA run --detectors @acme/lanterna-kinds-heap --kind heap --format json --output report.json -- node app.js
$LANTERNA run --detectors ./scripts/lanterna-plugin.mjs --kind cpu --format json --output report.json -- node app.js
$LANTERNA report report.json --format agent --output report.agent.md
```

Unknown kind ids fail before capture with `unknown profile kind(s): <ids>. Available kinds: ...`.
