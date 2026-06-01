# CPU hotspot example — sync crypto on a hot path

An auth service verifies a stream of login attempts with `pbkdf2Sync`. The synchronous key-derivation runs on the main thread, so every `verifyLogin` blocks the event loop; Lanterna detects it as a `sync-crypto-on-hot-path` finding.

## Run

From this directory:

```bash
npx -y @lanterna-profiler/cli run --duration 30s --output report.json -- node app.js
npx -y @lanterna-profiler/cli report report.json --format text
```

## What you should see

- A `findings[]` entry with `id: "sync-crypto-on-hot-path"`, `severity` of `warning` or higher, referencing the `hashPassword` / `verifyLogin` frames.
- `profiles.cpu.hotspots` dominated by frames inside `node:internal/crypto/pbkdf2`.
- `summary.userCodeRatio` low — most of the time is spent in native crypto, not in the user wrapper. This is expected (see [docs/troubleshooting.md#ratios-look-wrong](../../docs/troubleshooting.md#ratios-look-wrong)).

## What to try next

- Replace `pbkdf2Sync` with `pbkdf2` (callback or promisified) — the finding should disappear and the event loop becomes responsive.
- Run with `--format agent` to see the report shape an LLM would consume.
