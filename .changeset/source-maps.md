---
"@lanterna-profiler/core": minor
"@lanterna-profiler/detectors": patch
"@lanterna-profiler/cli": minor
---

Resolve generated `file:line` back to original sources via source maps. Hotspots, hot stacks, summary, memory allocators, async frames and finding evidence now carry an optional `source: { file, line, column?, name? }` field when a map is available. Discovery covers sibling `.map` files and inline `data:` URLs; remote schemes are skipped. Coverage and failures are reported under `meta.captureIntegrity.sourceMaps`. Disable with `--no-source-maps`. Text and Markdown renderers surface source-map coverage and prefer original source locations while keeping generated positions visible. See [docs/source-maps.md](https://github.com/arkerone/lanterna/blob/main/docs/source-maps.md).
