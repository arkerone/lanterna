# Configuration

Lanterna can read default options from a `.lanterna.json` (or `.lanterna.config.json`) file at the working directory root. This is the recommended way to share capture defaults across a team or pin them into a repository.

## File format

```json
{
  "duration": "30s",
  "output": "report.md",
  "format": "markdown",
  "pretty": true,
  "kinds": ["cpu", "memory"],
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

Every field maps 1:1 to a CLI flag. See [cli.md](./cli.md) for option semantics.

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
  "pretty": true
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

## See also

- [cli.md](./cli.md) — option reference and command semantics.
- [extending/plugin-loading.md](./extending/plugin-loading.md) — how `detectors` entries are resolved and what a plugin module must export.
