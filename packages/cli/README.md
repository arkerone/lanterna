# @lanterna-profiler/cli

The `lanterna` command-line binary for [Lanterna](https://github.com/arkerone/lanterna) — agent-first Node.js CPU, memory & experimental async profiler.

## Install

```bash
npm install -g @lanterna-profiler/cli
# or, without installing:
npx -y @lanterna-profiler/cli --help
```

## Usage

```bash
lanterna run --duration 30s --output report.json -- node app.js
lanterna attach --pid 4242 --duration 15s --output report.json
lanterna report report.json --format text
```

## Documentation

- [Getting started](https://github.com/arkerone/lanterna/blob/main/docs/getting-started.md) — first capture, reading the output.
- [CLI reference](https://github.com/arkerone/lanterna/blob/main/docs/cli.md) — every command, every flag, grouped by purpose.
- [Configuration](https://github.com/arkerone/lanterna/blob/main/docs/configuration.md) — `.lanterna.json`.
- [Troubleshooting](https://github.com/arkerone/lanterna/blob/main/docs/troubleshooting.md).

## Related packages

- [`@lanterna-profiler/core`](https://www.npmjs.com/package/@lanterna-profiler/core) — orchestration and analysis primitives.
- [`@lanterna-profiler/detectors`](https://www.npmjs.com/package/@lanterna-profiler/detectors) — default detector pack and plugin helpers.
