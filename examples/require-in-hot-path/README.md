# require-in-hot-path example

A misdesigned plugin loader `require()`s a module **inside the request loop**
(busting its cache entry each time) instead of loading it once at boot. Every
call pays full module resolution + compile cost, which Lanterna flags as
`require-in-hot-path`.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id: "require-in-hot-path"`, anchored on
  `loadPlugin`.
- `profiles.cpu.hotspots` showing time spent in `Module._load` / `require`.

## What to try next

- Hoist `loadPlugin()` out of the loop (load the plugin once at startup) and
  remove the `delete require.cache[...]` line — the finding should disappear.
