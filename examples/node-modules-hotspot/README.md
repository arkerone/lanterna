# node_modules hotspot example

The request loop calls into a dependency (`heavy-stats`) whose `summarize`
routine does an O(n²) computation. The dependency dominates the CPU profile, so
Lanterna raises a `node-modules-hotspot` finding attributed to the package.

`heavy-stats` is a **vendored fixture** under this folder's `node_modules/` — no
`npm install` is required.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `node-modules-hotspot:heavy-stats`,
  with the hot frame attributed to the `heavy-stats` package and `runBatch` as
  the user-code caller.
- `profiles.cpu.hotspots` dominated by `summarize` (category `node_modules`).

## What to try next

- Reduce the input size in `runBatch`, cache results, or replace the dependency
  for this workload — the finding should shrink or disappear.
