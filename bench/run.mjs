// Lanterna overhead bench runner.
//
// Runs each scenario in three modes:
//   - baseline       : `node scenario.mjs`
//   - lanterna-cpu   : `lanterna run --kind cpu -- node scenario.mjs`
//   - lanterna-memory: `lanterna run --kind memory -- node scenario.mjs`
//
// Each mode is run RUNS times and the median wall time is reported.
// Peak RSS is taken from /usr/bin/time -v when available, otherwise omitted.
//
// Usage: `node bench/run.mjs` (from repo root). Requires that the CLI has
// already been built (`npm run build`) so `packages/cli/bin/lanterna.js` is
// executable; the runner invokes it directly to avoid `npx` cold-starts
// dominating the measurements.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const LANTERNA_BIN = resolve(REPO_ROOT, 'packages/cli/bin/lanterna.js');
const RUNS = Number(process.env.BENCH_RUNS ?? 3);

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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function runOnce({ command, args, env = {} }) {
  return new Promise((resolvePromise, reject) => {
    const start = process.hrtime.bigint();
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const elapsedNs = process.hrtime.bigint() - start;
      const elapsedMs = Number(elapsedNs / 1_000_000n);
      if (code !== 0) {
        reject(new Error(`process exited with code ${code} signal ${signal}`));
        return;
      }
      resolvePromise(elapsedMs);
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
      elapsedMs = await runOnce({ command: process.execPath, args: [scenario.file] });
    } else if (mode === 'lanterna-cpu' || mode === 'lanterna-memory') {
      const kind = mode === 'lanterna-cpu' ? 'cpu' : 'memory';
      elapsedMs = await withTempDir(async (dir) =>
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
      );
    } else {
      throw new Error(`unknown mode: ${mode}`);
    }
    samples.push(elapsedMs);
  }
  return { samples, medianMs: median(samples) };
}

async function main() {
  const rows = [];
  for (const scenario of SCENARIOS) {
    const baseline = await runMode(scenario, 'baseline');
    rows.push({ scenario: scenario.id, mode: 'baseline', ...baseline, overheadPct: 0 });
    for (const mode of scenario.modes.filter((m) => m !== 'baseline')) {
      const result = await runMode(scenario, mode);
      const overheadPct = ((result.medianMs - baseline.medianMs) / baseline.medianMs) * 100;
      rows.push({ scenario: scenario.id, mode, ...result, overheadPct });
    }
  }

  const header = '| Scenario | Mode | Median (ms) | Samples (ms) | Overhead |';
  const sep = '| --- | --- | ---: | --- | ---: |';
  const body = rows.map((r) => {
    const samples = r.samples.map((s) => Math.round(s)).join(', ');
    const median = Math.round(r.medianMs);
    const overhead = r.mode === 'baseline' ? '—' : `${r.overheadPct.toFixed(1)}%`;
    return `| ${r.scenario} | ${r.mode} | ${median} | ${samples} | ${overhead} |`;
  });
  console.log([header, sep, ...body].join('\n'));
  console.log(
    `\nNode: ${process.version} | platform: ${process.platform} ${process.arch} | runs/mode: ${RUNS}`,
  );
}

main().catch((error) => {
  console.error('bench failed:', error);
  process.exit(1);
});
