---
"@lanterna-profiler/core": minor
"@lanterna-profiler/cli": minor
---

Add opt-in remote source-map fetching. When a generated file's `//# sourceMappingURL` points at an `http(s)://` URL, Lanterna can now resolve it — enable with `--source-map-remote` (CLI), `"sourceMapRemote": true` (`.lanterna.json`), or `sourceMapRemote: true` on the programmatic profile APIs. It is off by default because it is network egress. To keep frame resolution synchronous, remote maps are pre-fetched once up front (3 s timeout, 50 MiB cap) into a cache the sync resolver reads; failed/oversized fetches fall back to `unsupported-mapping-url`. The exported `SourceMapResolver` gains a `prefetchRemote` method and `createSourceMapResolver` an `allowRemote` option.
