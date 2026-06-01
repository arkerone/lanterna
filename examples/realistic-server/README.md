# realistic-server example — a small HTTP API with layered pathologies

Unlike the single-pathology examples, this is a `node:http` server that exhibits
several problems at once, profiled **under load**. It's the closest thing to a
real service: the CLI waits for readiness, drives traffic with a bundled load
generator, and captures CPU + memory while requests flow.

Per request the handler:

- `JSON.parse`s the request body and `JSON.stringify`s the response → `json-on-hot-path`
- builds per-item view models in `enrich` → CPU + allocation pressure
- every 50th request does a synchronous `readFileSync` → occasional `blocking-io`

## Run

From the **repo root** (paths below are root-relative):

```bash
npx -y @lanterna-profiler/cli run \
  --kind cpu,memory \
  --wait-for-url http://127.0.0.1:7070/health \
  --workload "node examples/load/http-load.mjs http://127.0.0.1:7070/process 32 20000" \
  --duration 25s \
  --output report.json \
  -- node examples/realistic-server/app.js

npx -y @lanterna-profiler/cli report report.json --format agent
```

`examples/load/http-load.mjs` is a dependency-free load generator (Node 22+
`fetch`); you can swap it for `autocannon` if you prefer.

## What you should see

- Reliably: a `json-on-hot-path:` finding under load.
- Typically also: `cpu-hotspot` / `alloc-in-hot-path` on `enrich`, `excessive-gc`,
  and the occasional `blocking-io:fs.readFileSync`.

## What to try next

- Cache the enriched response, drop the per-request `readFileSync`, and stream
  large bodies — watch the findings clear one by one.
