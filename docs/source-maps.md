# Source Maps

Lanterna captures profiling data from the **generated JavaScript** that V8 actually executes. When the app is written in TypeScript (or bundled), the raw `file:line` coordinates point at compiled output (`dist/`, `build/`, bundle chunks) — not at the source you would edit.

Source-map resolution joins each frame back to its **original source position** so consumers (humans and AI agents) can open the right file and propose patches against the right line.

## Activation

Source maps are **on by default**. Disable with:

```bash
lanterna run --no-source-maps -- node dist/server.js
lanterna attach --pid 4242 --no-source-maps
```

Disable when:

- the project ships JS only (no maps to find — keep the integrity counters clean),
- map files are huge and analysis time matters more than precision,
- you want to verify a frame's raw V8 location against the bundle.

## How discovery works

For every unique generated URL seen during capture, Lanterna:

1. Reads the tail of the JS file looking for a `//# sourceMappingURL=…` comment.
2. If the URL is a **sibling file** (e.g. `foo.js.map`), reads it.
3. If it is a **`data:` URL** (`application/json` base64 or uri-encoded), decodes inline.
4. Loads the parsed JSON into a `TraceMap` (`@jridgewell/trace-mapping`) for O(log n) lookups.

**Not supported:** remote schemes (`http://`, `https://`). Maps larger than 50 MiB are skipped.

## What lands in the report

### Per-frame `source`

Whenever a frame is mapped successfully, a `source` object is attached:

```json
{
  "file": "src/server.ts",
  "line": 42,
  "column": 18,
  "name": "handleRequest"
}
```

- `file` is **relative to the capture cwd** when the source is on disk; otherwise the raw map source URL is kept verbatim (e.g. `webpack://app/src/server.ts`, `vite:/src/server.ts`).
- `name` comes from the source map's `names` array — useful when the generated `function` is `(anonymous)`.
- `column` is **1-based** (matches Lanterna's frame convention).

`source` appears on:

- `profiles.cpu.hotspots[].source`
- `profiles.cpu.summary.topUserHotspot.source`
- `profiles.cpu.hotStacks[].frames[].source`
- `profiles.cpu.hotStacks[].clusters[].anchor.source`
- `profiles.memory.hotAllocators[].source` and the memory summary
- `profiles.async.*` (await sites and resource origins)
- `findings[].evidence.source`

### Integrity block — `meta.captureIntegrity.sourceMaps`

```json
{
  "enabled": true,
  "framesResolved": 1842,
  "framesUnresolved": 211,
  "coverage": 0.897,
  "mapsLoaded": 14,
  "failures": [
    { "url": "file:///app/dist/legacy.js", "reason": "map-read-failed: ENOENT" }
  ]
}
```

Use `coverage` as a quality gate. Below ~0.7, prefer raw `file:line` and warn the reader. The `failures[]` array is capped at 20 entries — informative, not exhaustive.

Failure reasons:

| reason | meaning |
| --- | --- |
| `not-file-url` | URL was not `file://` (e.g. `node:internal/...`). Filtered out — never appears in `failures`. |
| `no-mapping-url` | JS file has no `sourceMappingURL` comment. Filtered out. |
| `js-read-failed` | JS file could not be read (permissions, deletion mid-capture). |
| `map-read-failed` | `sourceMappingURL` pointed at a missing/unreadable file. |
| `map-parse-failed` | Map JSON or inline data URL is malformed. |
| `map-too-large` | Map exceeded the 50 MiB cap. |
| `unsupported-mapping-url` | Remote scheme (`http(s)://`) — not fetched. |

## Reading source-mapped data — agent contract

When consuming the JSON:

1. **Always prefer `source.file:source.line` over `file:line`** when `source` is present. Patches based on the generated coordinates will edit the wrong file (or no file at all).
2. **Fall back gracefully** to the generated `file:line` when `source` is absent — that means the frame had no map (e.g. a `node:` builtin, a stripped bundle).
3. **Treat virtual paths as untrusted.** A `source.file` with a bundler scheme (`webpack://`, `vite:/...`) is the bundler's logical path; it may not exist on disk. Verify via filesystem before quoting it as a fix location.
4. **Use `source.name` when `function` is `(anonymous)`** — the original symbol name often survives in the map.
5. **Check `meta.captureIntegrity.sourceMaps.coverage`** before stating "the hotspot is at `src/foo.ts:42`". Low coverage means most frames were not mapped; the few that were may still be misleading without the surrounding context.

## See also

- [report-schema.md](./report-schema.md) — full type definitions
- [reading-a-report.md](./reading-a-report.md) — interpretation playbook
- [signal-quality.md](./signal-quality.md) — the integrity model
