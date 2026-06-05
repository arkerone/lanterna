// Lanterna overhead bench runner.
//
// Scenarios:
//   - micro: short CPU / allocation programs run baseline vs. several `lanterna run`
//     modes (kind, sample-interval sweep, --deep, --heap-snapshot-analysis,
//     combined cpu,memory). Reports median wall time + overhead %.
//   - in-process: `profileInProcess()` vs. baseline on the same workload, in the
//     same process — reports wall overhead and a true peak-RSS overhead
//     (process.resourceUsage().maxRSS), the one place RSS is apples-to-apples.
//   - http: a realistic server under load, baseline vs. cpu/memory/async (safe &
//     full) spawn modes and an attach mode. Reports throughput + p50/p95/p99.
//
// Peak RSS is reported only for the in-process scenario. Measuring the *target's*
// RSS in spawn/attach mode from outside is unreliable (an external timer sees the
// CLI process, not the profiled child), so it is intentionally not claimed there.
//
// Usage: `node bench/run.mjs [--json]` from repo root, after `npm run build`.

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
const INCLUDE_INPROC = process.env.BENCH_SKIP_INPROC !== '1';
const INPROC_ITERATIONS = Number(process.env.BENCH_INPROC_ITERATIONS ?? 40);
const JSON_OUTPUT = process.argv.includes('--json') || process.env.BENCH_JSON === '1';

// Micro scenarios. Each mode's `args` is the lanterna option list (a function of
// the per-run temp dir when it needs a path), or `null` for the unprofiled baseline.
const MICRO_SCENARIOS = [
  {
    id: 'cpu-fib',
    file: resolve(__dirname, 'scenarios/cpu-fib.mjs'),
    modes: [
      { name: 'baseline', args: null },
      { name: 'lanterna-cpu', args: ['--kind', 'cpu'] },
      { name: 'lanterna-cpu-si250', args: ['--kind', 'cpu', '--sample-interval', '250'] },
      { name: 'lanterna-cpu-si4000', args: ['--kind', 'cpu', '--sample-interval', '4000'] },
      { name: 'lanterna-cpu-deep', args: ['--kind', 'cpu', '--deep'] },
      { name: 'lanterna-cpu-memory', args: ['--kind', 'cpu,memory'] },
    ],
  },
  {
    id: 'alloc-heavy',
    file: resolve(__dirname, 'scenarios/alloc-heavy.mjs'),
    modes: [
      { name: 'baseline', args: null },
      { name: 'lanterna-memory', args: ['--kind', 'memory'] },
      {
        name: 'lanterna-memory-heapsnapshot',
        args: (dir) => [
          '--kind',
          'memory',
          '--heap-snapshot-analysis',
          '--heap-snapshot-dir',
          join(dir, 'heaps'),
        ],
      },
    ],
  },
];

const INPROC_SCENARIO = {
  id: 'in-process-cpu',
  file: resolve(__dirname, 'scenarios/in-process-workload.mjs'),
  modes: ['baseline', 'profile'],
};

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
    'lanterna-http-attach-cpu',
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
      const elapsedMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
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

// ---- Micro scenarios -------------------------------------------------------

async function runMicroMode(scenario, mode) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    let elapsedMs;
    if (mode.args === null) {
      ({ elapsedMs } = await runOnce({ command: process.execPath, args: [scenario.file] }));
    } else {
      ({ elapsedMs } = await withTempDir(async (dir) => {
        const lanternaArgs = typeof mode.args === 'function' ? mode.args(dir) : mode.args;
        return runOnce({
          command: process.execPath,
          args: [
            LANTERNA_BIN,
            'run',
            ...lanternaArgs,
            '--output',
            join(dir, 'report.json'),
            '--',
            process.execPath,
            scenario.file,
          ],
        });
      }));
    }
    samples.push(elapsedMs);
  }
  return { samples, medianMs: median(samples) };
}

async function runMicroScenarios() {
  const rows = [];
  for (const scenario of MICRO_SCENARIOS) {
    const baseline = await runMicroMode(scenario, { name: 'baseline', args: null });
    rows.push({ scenario: scenario.id, mode: 'baseline', ...baseline, overheadPct: 0 });
    for (const mode of scenario.modes.filter((m) => m.name !== 'baseline')) {
      const result = await runMicroMode(scenario, mode);
      const overheadPct = ((result.medianMs - baseline.medianMs) / baseline.medianMs) * 100;
      rows.push({ scenario: scenario.id, mode: mode.name, ...result, overheadPct });
    }
  }
  return rows;
}

// ---- In-process scenario ---------------------------------------------------

function parseInProcMetrics(stdout) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith('LANTERNA_INPROC_BENCH '));
  if (!line)
    throw new Error(`in-process bench printed no metrics. stdout:\n${stdout.slice(-1000)}`);
  return JSON.parse(line.slice('LANTERNA_INPROC_BENCH '.length));
}

async function runInProcMode(mode) {
  const workloadSamples = [];
  const rssSamples = [];
  for (let i = 0; i < RUNS; i++) {
    const { stdout } = await runOnce({
      command: process.execPath,
      args: [INPROC_SCENARIO.file, mode, String(INPROC_ITERATIONS)],
    });
    const metrics = parseInProcMetrics(stdout);
    workloadSamples.push(metrics.workloadMs);
    rssSamples.push(metrics.maxRssBytes);
  }
  return { medianMs: median(workloadSamples), peakRssBytes: median(rssSamples) };
}

async function runInProcScenario() {
  const baseline = await runInProcMode('baseline');
  const rows = [
    {
      scenario: INPROC_SCENARIO.id,
      mode: 'baseline',
      medianMs: baseline.medianMs,
      peakRssBytes: baseline.peakRssBytes,
      overheadPct: 0,
      rssDeltaPct: 0,
    },
  ];
  const profile = await runInProcMode('profile');
  rows.push({
    scenario: INPROC_SCENARIO.id,
    mode: 'profileInProcess',
    medianMs: profile.medianMs,
    peakRssBytes: profile.peakRssBytes,
    overheadPct: ((profile.medianMs - baseline.medianMs) / baseline.medianMs) * 100,
    rssDeltaPct: ((profile.peakRssBytes - baseline.peakRssBytes) / baseline.peakRssBytes) * 100,
  });
  return rows;
}

// ---- HTTP scenario ---------------------------------------------------------

async function runHttpMode(mode, runIndex) {
  const port = HTTP_BASE_PORT + runIndex;
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const processUrl = `http://127.0.0.1:${port}/process`;
  const load = (extraDelayMs = 0) =>
    runOnce({
      command: process.execPath,
      args: [
        HTTP_SCENARIO.loadFile,
        processUrl,
        String(HTTP_CONCURRENCY),
        String(HTTP_DURATION_MS + extraDelayMs),
      ],
    });

  if (mode === 'baseline') {
    const server = startServer(port, /* inspect */ false);
    try {
      await waitForUrl(healthUrl);
      const result = await load();
      return { elapsedMs: result.elapsedMs, metrics: parseHttpMetrics(result.stdout) };
    } finally {
      await stopProcess(server);
    }
  }

  if (mode === 'lanterna-http-attach-cpu') {
    return await runHttpAttachMode(port, healthUrl);
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
    const result = await runOnce({ command: process.execPath, args, env: { PORT: String(port) } });
    return { elapsedMs: result.elapsedMs, metrics: parseHttpMetrics(result.stdout) };
  });
}

function startServer(port, inspect) {
  const args = inspect ? ['--inspect=0', HTTP_SCENARIO.file] : [HTTP_SCENARIO.file];
  return spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  });
}

// Attach to an already-running server (by pid, POSIX SIGUSR1) and drive load
// concurrently with the attach capture, comparing throughput to baseline.
async function runHttpAttachMode(port, healthUrl) {
  const processUrl = `http://127.0.0.1:${port}/process`;
  const server = startServer(port, /* inspect */ false);
  try {
    await waitForUrl(healthUrl);
    return await withTempDir(async (dir) => {
      const attach = spawn(
        process.execPath,
        [
          LANTERNA_BIN,
          'attach',
          '--pid',
          String(server.pid),
          '--kind',
          'cpu',
          '--duration',
          `${HTTP_DURATION_MS + 1_000}ms`,
          '--output',
          join(dir, 'report.json'),
        ],
        { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const attachExit = once(attach, 'exit');
      // Give the inspector a moment to attach before measuring.
      await sleep(500);
      const result = await runOnce({
        command: process.execPath,
        args: [
          HTTP_SCENARIO.loadFile,
          processUrl,
          String(HTTP_CONCURRENCY),
          String(HTTP_DURATION_MS),
        ],
      });
      await Promise.race([attachExit, sleep(5_000)]);
      await stopProcess(attach);
      return { elapsedMs: result.elapsedMs, metrics: parseHttpMetrics(result.stdout) };
    });
  } finally {
    await stopProcess(server);
  }
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
  return { samples, medianMs, requestsPerSec, p50Ms, p95Ms, p99Ms, errors, throughputDeltaPct };
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

// ---- Orchestration + rendering --------------------------------------------

function buildMeta() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    runsPerMode: RUNS,
    http: INCLUDE_HTTP
      ? { durationMs: HTTP_DURATION_MS, concurrency: HTTP_CONCURRENCY, basePort: HTTP_BASE_PORT }
      : null,
    inProcess: INCLUDE_INPROC ? { iterations: INPROC_ITERATIONS } : null,
    generatedAt: new Date().toISOString(),
  };
}

function toJsonResult(result) {
  return {
    meta: result.meta,
    micro: result.micro.map(({ samples: _s, ...row }) => ({
      ...row,
      medianMs: Math.round(row.medianMs),
      overheadPct: Number(row.overheadPct.toFixed(1)),
    })),
    inProcess: result.inProcess.map((row) => ({
      ...row,
      medianMs: Math.round(row.medianMs),
      peakRssBytes: Math.round(row.peakRssBytes),
      overheadPct: Number(row.overheadPct.toFixed(1)),
      rssDeltaPct: Number(row.rssDeltaPct.toFixed(1)),
    })),
    http: result.http.map(({ samples: _s, ...row }) => ({
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

function mib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}`;
}

function renderMarkdown(result) {
  const header = '| Scenario | Mode | Median (ms) | Samples (ms) | Overhead |';
  const sep = '| --- | --- | ---: | --- | ---: |';
  const body = result.micro.map((r) => {
    const samples = r.samples.map((s) => Math.round(s)).join(', ');
    const overhead = r.mode === 'baseline' ? '—' : `${r.overheadPct.toFixed(1)}%`;
    return `| ${r.scenario} | ${r.mode} | ${Math.round(r.medianMs)} | ${samples} | ${overhead} |`;
  });
  console.log([header, sep, ...body].join('\n'));

  if (result.inProcess.length > 0) {
    const ipHeader = '| Scenario | Mode | Median (ms) | Overhead | Peak RSS (MiB) | RSS Δ |';
    const ipSep = '| --- | --- | ---: | ---: | ---: | ---: |';
    const ipBody = result.inProcess.map((r) => {
      const overhead = r.mode === 'baseline' ? '—' : `${r.overheadPct.toFixed(1)}%`;
      const rssDelta = r.mode === 'baseline' ? '—' : `${r.rssDeltaPct.toFixed(1)}%`;
      return `| ${r.scenario} | ${r.mode} | ${Math.round(r.medianMs)} | ${overhead} | ${mib(r.peakRssBytes)} | ${rssDelta} |`;
    });
    console.log(`\n${[ipHeader, ipSep, ...ipBody].join('\n')}`);
  }

  if (result.http.length > 0) {
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
  }
}

async function runBench() {
  const micro = await runMicroScenarios();
  const inProcess = INCLUDE_INPROC ? await runInProcScenario() : [];
  const http = INCLUDE_HTTP ? await runHttpScenario() : [];
  return { meta: buildMeta(), micro, inProcess, http };
}

async function main() {
  const result = await runBench();
  if (JSON_OUTPUT) {
    process.stdout.write(`${JSON.stringify(toJsonResult(result), null, 2)}\n`);
    return;
  }
  renderMarkdown(result);
}

export { runBench, toJsonResult };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('bench failed:', error);
    process.exit(1);
  });
}
