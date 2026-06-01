# CPU hotspot example — pure user code

A naive relevance scorer does O(doc × query) character matching in `scoreDocument`.
There's no syscall, no dependency and no special anti-pattern — just expensive
user code — so Lanterna surfaces it as a generic `cpu-hotspot` finding.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id` starting `cpu-hotspot:` anchored on
  `scoreDocument`, with high self CPU.
- A high `summary.userCodeRatio` (the cost is in your own code, not native).

## What to try next

- Replace the nested loop with a smarter algorithm (index the document, or use a
  real distance metric) and watch the hotspot shrink.
