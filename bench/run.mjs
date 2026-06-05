// Lanterna overhead bench runner.
//
// Runs micro scenarios in profiler-specific modes:
//   - baseline       : `node scenario.mjs`
//   - lanterna-cpu   : `lanterna run --kind cpu -- node scenario.mjs`
//   - lanterna-memory: `lanterna run --kind memory -- node scenario.mjs`
//
// Also runs an HTTP service scenario under load unless BENCH_SKIP_HTTP=1.
//
// Each mode is run RUNS times and the median wall time is reported.
// Peak RSS is taken from /usr/bin/time -v when available, otherwise omitted.
//
// Usage: `node bench/run.mjs` (from repo root). Requires that the CLI has
// already been built (`npm run build`) so `packages/cli/bin/lanterna.js` is
// executable; the runner invokes it directly to avoid `npx` cold-starts
// dominating the measurements.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const LANTERNA_BIN = resolve(REPO_ROOT, 'packages/cli/bin/lanterna.js');
const RUNS = Number(process.env.BENCH_RUNS ?? 3);
const HTTP_DURATION_MS = Number(process.env.BENCH_HTTP_DURATION_MS ?? 8_000);
const HTTP_CONCURRENCY = Number(process.env.BENCH_HTTP_CONCURRENCY ?? 32);
const HTTP_BASE_PORT = Number(process.env.BENCH_HTTP_PORT ?? 7070);
const INCLUDE_HTTP = process.env.BENCH_SKIP_HTTP !== '1';

const SCENARIOS = [
  {
    id: 'cpu-fib',
    file: resolve(__dirname, 'scenarios/cpu-fib.mjs'),
    modes: ['baseline', 'lanterna-cpu'],
  },
  {
    id: 'alloc-heavy',
    file: resolve(__dirname, 'scenarios/alloc-heavy.mjs'),
    modes: ['baseline', 'lanterna-memory'],
  },
];

const HTTP_SCENARIO = {
  id: 'http-realistic-server',
  file: resolve(REPO_ROOT, 'examples/realistic-server/app.js'),
  loadFile: resolve(__dirname, 'scenarios/http-load.mjs'),
  modes: [
    'baseline',
    'lanterna-http-cpu',
    'lanterna-http-memory',
    'lanterna-http-cpu-memory',
    'lanterna-http-async-safe',
    'lanterna-http-async-full',
  ],
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function runOnce({ command, args, env = {}, cwd = REPO_ROOT }) {
  return new Promise((resolvePromise, reject) => {
    const start = process.hrtime.bigint();
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      if (process.env.BENCH_VERBOSE === '1') process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
      if (process.env.BENCH_VERBOSE === '1') process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const elapsedNs = process.hrtime.bigint() - start;
      const elapsedMs = Number(elapsedNs / 1_000_000n);
      if (code !== 0) {
        reject(
          new Error(
            [
              `process exited with code ${code} signal ${signal}`,
              stdout ? `stdout:\n${stdout.slice(-1000)}` : '',
              stderr ? `stderr:\n${stderr.slice(-1000)}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          ),
        );
        return;
      }
      resolvePromise({ elapsedMs, stdout, stderr });
    });
  });
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'lanterna-bench-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runMode(scenario, mode) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    let elapsedMs;
    if (mode === 'baseline') {
      ({ elapsedMs } = await runOnce({ command: process.execPath, args: [scenario.file] }));
    } else if (mode === 'lanterna-cpu' || mode === 'lanterna-memory') {
      const kind = mode === 'lanterna-cpu' ? 'cpu' : 'memory';
      ({ elapsedMs } = await withTempDir(async (dir) =>
        runOnce({
          command: process.execPath,
          args: [
            LANTERNA_BIN,
            'run',
            '--kind',
            kind,
            '--output',
            join(dir, 'report.json'),
            '--',
            process.execPath,
            scenario.file,
          ],
        }),
      ));
    } else {
      throw new Error(`unknown mode: ${mode}`);
    }
    samples.push(elapsedMs);
  }
  return { samples, medianMs: median(samples) };
}

async function runHttpMode(mode, runIndex) {
  const port = HTTP_BASE_PORT + runIndex;
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const processUrl = `http://127.0.0.1:${port}/process`;
  if (mode === 'baseline') {
    const server = spawn(process.execPath, [HTTP_SCENARIO.file], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', process.env.BENCH_VERBOSE === '1' ? 'inherit' : 'ignore'],
      env: { ...process.env, PORT: String(port) },
    });
    try {
      await waitForUrl(healthUrl);
      const result = await runOnce({
        command: process.execPath,
        args: [
          HTTP_SCENARIO.loadFile,
          processUrl,
          String(HTTP_CONCURRENCY),
          String(HTTP_DURATION_MS),
        ],
      });
      return { elapsedMs: result.elapsedMs, metrics: parseHttpMetrics(result.stdout) };
    } finally {
      await stopProcess(server);
    }
  }

  const modeOptions = httpLanternaModeOptions(mode);
  return await withTempDir(async (dir) => {
    const args = [
      LANTERNA_BIN,
      'run',
      '--kind',
      modeOptions.kinds,
      '--duration',
      `${HTTP_DURATION_MS + 1_000}ms`,
      '--wait-for-url',
      healthUrl,
      '--workload',
      `${process.execPath} ${HTTP_SCENARIO.loadFile} ${processUrl} ${HTTP_CONCURRENCY} ${HTTP_DURATION_MS}`,
      '--output',
      join(dir, 'report.json'),
    ];
    if (modeOptions.asyncInstrumentation) {
      args.push('--async-instrumentation', modeOptions.asyncInstrumentation);
    }
    args.push('--', process.execPath, HTTP_SCENARIO.file);
    const result = await runOnce({
      command: process.execPath,
      args,
      env: { PORT: String(port) },
    });
    return { elapsedMs: result.elapsedMs, metrics: parseHttpMetrics(result.stdout) };
  });
}

async function runHttpScenario() {
  const rows = [];
  const baselineSamples = [];
  for (let i = 0; i < RUNS; i++) {
    baselineSamples.push(await runHttpMode('baseline', i));
  }
  const baseline = summarizeHttpSamples(baselineSamples);
  rows.push({ scenario: HTTP_SCENARIO.id, mode: 'baseline', ...baseline });

  for (const mode of HTTP_SCENARIO.modes.filter((m) => m !== 'baseline')) {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      samples.push(await runHttpMode(mode, i));
    }
    rows.push({
      scenario: HTTP_SCENARIO.id,
      mode,
      ...summarizeHttpSamples(samples, baseline.requestsPerSec),
    });
  }
  return rows;
}

function summarizeHttpSamples(samples, baselineRps) {
  const medianMs = median(samples.map((sample) => sample.elapsedMs));
  const requestsPerSec = median(samples.map((sample) => sample.metrics.requestsPerSec));
  const p50Ms = median(samples.map((sample) => sample.metrics.p50Ms));
  const p95Ms = median(samples.map((sample) => sample.metrics.p95Ms));
  const p99Ms = median(samples.map((sample) => sample.metrics.p99Ms));
  const errors = median(samples.map((sample) => sample.metrics.errors));
  const throughputDeltaPct =
    baselineRps === undefined ? 0 : ((requestsPerSec - baselineRps) / baselineRps) * 100;
  return {
    samples,
    medianMs,
    requestsPerSec,
    p50Ms,
    p95Ms,
    p99Ms,
    errors,
    throughputDeltaPct,
  };
}

function httpLanternaModeOptions(mode) {
  switch (mode) {
    case 'lanterna-http-cpu':
      return { kinds: 'cpu' };
    case 'lanterna-http-memory':
      return { kinds: 'memory' };
    case 'lanterna-http-cpu-memory':
      return { kinds: 'cpu,memory' };
    case 'lanterna-http-async-safe':
      return { kinds: 'cpu,async', asyncInstrumentation: 'safe' };
    case 'lanterna-http-async-full':
      return { kinds: 'cpu,async', asyncInstrumentation: 'full' };
    default:
      throw new Error(`unknown HTTP mode: ${mode}`);
  }
}

function parseHttpMetrics(stdout) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('LANTERNA_HTTP_BENCH '));
  if (!line)
    throw new Error(`HTTP benchmark did not print metrics. stdout:\n${stdout.slice(-1000)}`);
  return JSON.parse(line.slice('LANTERNA_HTTP_BENCH '.length));
}

async function waitForUrl(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = once(child, 'exit').then(() => true);
  const timedOut = sleep(2_000).then(() => false);
  if (!(await Promise.race([exited, timedOut]))) {
    child.kill('SIGKILL');
    await once(child, 'exit').catch(() => undefined);
  }
}

const JSON_OUTPUT = process.argv.includes('--json') || process.env.BENCH_JSON === '1';

function buildMeta() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runsPerMode: RUNS,
    http: INCLUDE_HTTP
      ? { durationMs: HTTP_DURATION_MS, concurrency: HTTP_CONCURRENCY, basePort: HTTP_BASE_PORT }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

// Drop the per-run `samples` arrays so the JSON result is a compact, diffable summary
// suitable for committing as a baseline.
function toJsonResult(result) {
  return {
    meta: result.meta,
    micro: result.micro.map(({ samples: _samples, ...row }) => ({
      ...row,
      medianMs: Math.round(row.medianMs),
      overheadPct: Number(row.overheadPct.toFixed(1)),
    })),
    http: result.http.map(({ samples: _samples, ...row }) => ({
      ...row,
      medianMs: Math.round(row.medianMs),
      requestsPerSec: Number(row.requestsPerSec.toFixed(1)),
      p50Ms: Number(row.p50Ms.toFixed(1)),
      p95Ms: Number(row.p95Ms.toFixed(1)),
      p99Ms: Number(row.p99Ms.toFixed(1)),
      throughputDeltaPct: Number(row.throughputDeltaPct.toFixed(1)),
    })),
  };
}

function renderMarkdown(result) {
  const header = '| Scenario | Mode | Median (ms) | Samples (ms) | Overhead |';
  const sep = '| --- | --- | ---: | --- | ---: |';
  const body = result.micro.map((r) => {
    const samples = r.samples.map((s) => Math.round(s)).join(', ');
    const median = Math.round(r.medianMs);
    const overhead = r.mode === 'baseline' ? '—' : `${r.overheadPct.toFixed(1)}%`;
    return `| ${r.scenario} | ${r.mode} | ${median} | ${samples} | ${overhead} |`;
  });
  console.log([header, sep, ...body].join('\n'));

  if (INCLUDE_HTTP) {
    const httpHeader =
      '| Scenario | Mode | Median wall (ms) | RPS | RPS delta | p50 (ms) | p95 (ms) | p99 (ms) | Errors |';
    const httpSep = '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
    const httpBody = result.http.map((row) => {
      const delta = row.mode === 'baseline' ? '—' : `${row.throughputDeltaPct.toFixed(1)}%`;
      return `| ${row.scenario} | ${row.mode} | ${Math.round(row.medianMs)} | ${row.requestsPerSec.toFixed(1)} | ${delta} | ${row.p50Ms.toFixed(1)} | ${row.p95Ms.toFixed(1)} | ${row.p99Ms.toFixed(1)} | ${row.errors} |`;
    });
    console.log(`\n${[httpHeader, httpSep, ...httpBody].join('\n')}`);
  }
  console.log(
    `\nNode: ${result.meta.node} | platform: ${result.meta.platform} ${result.meta.arch} | runs/mode: ${result.meta.runsPerMode}`,
  );
  if (INCLUDE_HTTP) {
    console.log(
      `HTTP: duration=${HTTP_DURATION_MS}ms | concurrency=${HTTP_CONCURRENCY} | basePort=${HTTP_BASE_PORT}`,
    );
  } else {
    console.log('HTTP: skipped (BENCH_SKIP_HTTP=1)');
  }
}

async function runBench() {
  const microRows = [];
  for (const scenario of SCENARIOS) {
    const baseline = await runMode(scenario, 'baseline');
    microRows.push({ scenario: scenario.id, mode: 'baseline', ...baseline, overheadPct: 0 });
    for (const mode of scenario.modes.filter((m) => m !== 'baseline')) {
      const result = await runMode(scenario, mode);
      const overheadPct = ((result.medianMs - baseline.medianMs) / baseline.medianMs) * 100;
      microRows.push({ scenario: scenario.id, mode, ...result, overheadPct });
    }
  }
  const httpRows = INCLUDE_HTTP ? await runHttpScenario() : [];
  return { meta: buildMeta(), micro: microRows, http: httpRows };
}

async function main() {
  const result = await runBench();
  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(toJsonResult(result), null, 2)}\n`);
    return;
  }
  renderMarkdown(result);
}

// Exported for `scripts/check-bench.mjs`.
export { runBench, toJsonResult };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('bench failed:', error);
    process.exit(1);
  });
}
