# Configuration

Lanterna can read default options from a `.lanterna.json` (or `.lanterna.config.json`) file at the working directory root. This is the recommended way to share capture defaults across a team or pin them into a repository.

## File format

```json
{
  "duration": "30s",
  "output": "report.agent.md",
  "format": "agent",
  "pretty": true,
  "sourceMaps": true,
  "sourceMapRemote": false,
  "kinds": ["cpu", "memory", "async"],
  "sampleInterval": 1000,
  "heapSampleInterval": "512KiB",
  "memoryUsageInterval": 250,
  "includeMemorySamples": false,
  "heapSnapshotAnalysis": false,
  "heapSnapshotDir": ".lanterna-heapsnapshots",
  "asyncMaxEvents": 50000,
  "asyncStackDepth": 32,
  "asyncIncludeMicrotasks": false,
  "asyncConcurrencyInterval": "100ms",
  "asyncInstrumentation": "safe",
  "waitForUrl": "http://127.0.0.1:3000/health",
  "waitTimeout": "30s",
  "captureDelay": "250ms",
  "workload": "npx -y autocannon http://127.0.0.1:3000",
  "detectors": [
    "@acme/lanterna-detectors-prisma",
    "./scripts/lanterna-plugin.mjs"
  ]
}
```

Every field maps 1:1 to a CLI flag. `format` accepts `json`, `text`, `markdown`, or `agent`. `sourceMaps` defaults to `true`; set it to `false` to match `--no-source-maps`. `sourceMapRemote` defaults to `false`; set it to `true` to match `--source-map-remote` (fetch remote `http(s)` source maps — network egress). See [cli.md](./cli.md) for option semantics.

Kind-scoped options only apply when their kind is enabled, and Lanterna rejects a config that sets them without the matching kind: `heapSnapshotAnalysis` / `heapSnapshotDir` require `"memory"` in `kinds`, and the `async*` options require `"async"`. The all-fields example above lists every kind for that reason — a real config only enables the kinds it uses.

## Load order

1. Lanterna loads `.lanterna.json` (or `.lanterna.config.json`) from the working directory if present.
2. CLI flags are applied on top. **CLI flags win** for scalar fields.
3. The `detectors` array is **additive**: config entries load first, then any plugins from `--detectors` flags.

This keeps a versioned baseline (e.g. workload, output format) and lets a developer override a field without editing the file.

## Examples by use case

### Always profile a server with the same workload

```json
{
  "duration": "30s",
  "kinds": ["cpu", "memory"],
  "waitForUrl": "http://127.0.0.1:3000/health",
  "workload": "npx -y autocannon http://127.0.0.1:3000",
  "format": "markdown",
  "output": "report.md",
  "pretty": true,
  "sourceMaps": true
}
```

`lanterna run -- node server.js` will then capture for 30 s after readiness, drive load from autocannon, and write `report.md`.

### Standard memory leak hunt

```json
{
  "duration": "60s",
  "kinds": ["memory"],
  "heapSnapshotAnalysis": true,
  "heapSnapshotDir": ".lanterna-heapsnapshots",
  "includeMemorySamples": true
}
```

### Bake in your team's plugins

```json
{
  "kinds": ["cpu"],
  "detectors": [
    "@acme/lanterna-detectors-prisma",
    "@acme/lanterna-detectors-redis"
  ]
}
```

Plugins listed here are loaded for every run. Authors can add more on the command line with `--detectors <spec>`.

Plugins are trusted code loaded by the Lanterna CLI, and profile-kind plugins may inject target runtime hooks. Pin and review shared plugin entries the same way you review other developer tooling dependencies. See [security-and-privacy.md](./security-and-privacy.md).

## See also

- [cli.md](./cli.md) — option reference and command semantics.
- [extending/plugin-loading.md](./extending/plugin-loading.md) — how `detectors` entries are resolved and what a plugin module must export.
- [security-and-privacy.md](./security-and-privacy.md) — trust model for reports, plugins, inspector, and heap snapshots.
