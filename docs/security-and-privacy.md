# Security And Privacy

Lanterna is a profiler, so it observes and sometimes injects code into Node.js processes. Treat reports and plugins as trusted developer artifacts, not public logs.

## What Lanterna Can Observe

A report can include:

- command arguments and the working directory,
- process metadata such as pid, Node.js version, platform, and architecture,
- file paths, function names, line/column numbers, and source-map paths,
- stack traces and source-mapped original locations,
- timing signals for CPU, GC, event-loop lag, memory usage, async resources, and findings,
- heap allocation summaries, and optionally heap-snapshot-derived retained-growth summaries.

Lanterna does not intentionally collect environment variables, request bodies, secrets, or heap object contents in the default report. However, file paths, command arguments, function names, source-map paths, plugin output, and heap snapshot analysis can still reveal sensitive application structure. Review reports before sharing them outside the team.

## Inspector And Attach Mode

`lanterna run` starts the target with `--inspect-brk=0`, connects locally over the V8 inspector, installs preload hooks, captures the requested kinds, and then writes a report.

`lanterna attach` connects to an already-running inspector endpoint or opens one with `SIGUSR1` when supported. This is operationally powerful:

- Prefer local inspector endpoints bound to `127.0.0.1`.
- Avoid exposing inspector ports on public or shared networks.
- Use staging or a controlled host when possible.
- In production-like environments, capture for the shortest representative window and read `profiles.<kind>.quality` before acting.
- Remember that attach mode installs runtime hooks after the process has already started, so async capture is partial by design.

If your environment forbids inspector access, Lanterna should fail fast rather than falling back to weaker evidence.

## Runtime Hooks

Lanterna injects runtime hooks to observe GC, event-loop timing, memory usage, async resources, and optional await instrumentation. Spawn mode injects a composed CommonJS preload through `NODE_OPTIONS --require=<tmpfile>`. Attach mode evaluates an equivalent runtime hook through CDP.

The hooks are designed to clean up after capture, and capture-integrity fields record degraded channels. Still, they run inside the target process. Use representative staging when you cannot tolerate any in-process instrumentation risk.

The programmatic `profileInProcess()` API runs the same hooks in the **current** process via an in-process inspector session (no child, no socket). It carries the same in-process instrumentation considerations as attach.

## Network egress: remote source maps

Source-map resolution reads from the local filesystem by default and performs **no network requests**. The opt-in `--source-map-remote` / `sourceMapRemote: true` is the one exception: it fetches `http(s)://` `sourceMappingURL` targets from the machine running Lanterna. Only enable it for map hosts you trust; the fetched map paths and names can end up in `evidence.file` and the report. Leave it off in locked-down or air-gapped environments.

## Plugins

Detector and kind plugins are trusted code.

- A detector plugin runs in the Lanterna CLI process.
- A profile-kind plugin may contribute runtime hook code that runs in the target process.
- Local plugin paths are resolved from the current working directory.
- Package plugins should be installed from trusted sources and pinned through normal dependency management.

Do not load arbitrary plugins from unreviewed repositories or build artifacts.

## Report Handling

Recommended handling:

- Store reports with the same care as application diagnostics.
- Redact command arguments or paths before posting reports publicly.
- Disable source maps with `--no-source-maps` if original source paths should not be exposed.
- Avoid enabling `--heap-snapshot-analysis` on sensitive production data unless you control the output directory and retention.
- Clean up `.lanterna-heapsnapshots` or any custom heap snapshot directory after analysis.
- Do not paste full reports into third-party tools unless your team allows the contained metadata to leave your environment.

## CI And Staging Pattern

The safest adoption path is:

1. Add a `.lanterna.json` with representative local/staging defaults.
2. Run `lanterna run` in CI or staging against deterministic workloads.
3. Keep `--format agent` reports as build artifacts with restricted access.
4. Use production attach only for short, deliberate investigations where inspector access is acceptable.

## See Also

- [CLI reference](./cli.md)
- [Configuration](./configuration.md)
- [Plugin loading](./extending/plugin-loading.md)
- [Signal quality](./signal-quality.md)
- [Troubleshooting](./troubleshooting.md)
