// Benchmark regression check.
//
// Runs the bench suite and compares its overhead numbers against the committed
// baseline (`bench/baseline.json`). Absolute wall times vary per machine, so the
// check compares the *relative* numbers that the baseline is meant to protect:
//   - micro scenarios: `overheadPct`
//   - HTTP scenarios:  `throughputDeltaPct` (negative = slower than baseline)
//
// This is intentionally lenient and **non-gating by default** — machine variance
// makes hard gating flaky. It prints a comparison table and exits 0 unless run
// with `--strict` (or `BENCH_CHECK_STRICT=1`), in which case a regression beyond
// tolerance exits non-zero. Refresh the baseline with `npm run bench:baseline`.
//
// Usage: `node scripts/check-bench.mjs [--strict]`

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench, toJsonResult } from '../bench/run.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(repoRoot, 'bench/baseline.json');

// Allowed drift, in percentage points, before a number counts as a regression.
const MICRO_TOLERANCE_PP = Number(process.env.BENCH_MICRO_TOLERANCE_PP ?? 15);
const HTTP_TOLERANCE_PP = Number(process.env.BENCH_HTTP_TOLERANCE_PP ?? 10);
const STRICT = process.argv.includes('--strict') || process.env.BENCH_CHECK_STRICT === '1';

function keyFor(row) {
  return `${row.scenario} :: ${row.mode}`;
}

function index(rows) {
  const map = new Map();
  for (const row of rows) map.set(keyFor(row), row);
  return map;
}

async function main() {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch (error) {
    console.error(`could not read baseline at ${baselinePath}: ${error.message}`);
    console.error('generate one with `npm run bench:baseline`.');
    process.exit(2);
  }

  const current = toJsonResult(await runBench());
  const regressions = [];
  const lines = [];

  const compare = (label, baseRows, curRows, field, tolerance, worseWhenLower) => {
    const baseIdx = index(baseRows);
    lines.push(`\n${label} (${field}, tolerance ${tolerance}pp):`);
    for (const row of curRows) {
      if (row.mode === 'baseline') continue;
      const base = baseIdx.get(keyFor(row));
      if (!base) {
        lines.push(`  ? ${keyFor(row)} — new, not in baseline (${field}=${row[field]})`);
        continue;
      }
      const delta = row[field] - base[field];
      // worseWhenLower: a drop is bad (throughput). Else a rise is bad (overhead).
      const worse = worseWhenLower ? -delta : delta;
      const regressed = worse > tolerance;
      const marker = regressed ? 'REGRESSION' : 'ok';
      lines.push(
        `  ${regressed ? '✗' : '✓'} ${keyFor(row)} — baseline ${base[field]} → ${row[field]} (Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp) ${marker}`,
      );
      if (regressed) regressions.push(`${keyFor(row)} ${field} Δ ${delta.toFixed(1)}pp`);
    }
  };

  compare(
    'Micro overhead',
    baseline.micro ?? [],
    current.micro,
    'overheadPct',
    MICRO_TOLERANCE_PP,
    false,
  );
  if ((baseline.inProcess?.length ?? 0) > 0 && (current.inProcess?.length ?? 0) > 0) {
    compare(
      'In-process overhead',
      baseline.inProcess,
      current.inProcess,
      'overheadPct',
      MICRO_TOLERANCE_PP,
      false,
    );
  }
  if ((baseline.http?.length ?? 0) > 0 && current.http.length > 0) {
    compare(
      'HTTP throughput',
      baseline.http,
      current.http,
      'throughputDeltaPct',
      HTTP_TOLERANCE_PP,
      true,
    );
  }

  console.log(lines.join('\n'));
  console.log(
    `\nBaseline: ${baseline.meta?.node} ${baseline.meta?.platform}/${baseline.meta?.arch} @ ${baseline.meta?.generatedAt}`,
  );
  console.log(`Current:  ${current.meta.node} ${current.meta.platform}/${current.meta.arch}`);

  if (regressions.length === 0) {
    console.log('\nNo regressions beyond tolerance.');
    return;
  }

  console.log(`\n${regressions.length} regression(s) beyond tolerance:`);
  for (const r of regressions) console.log(`  - ${r}`);
  if (STRICT) {
    process.exit(1);
  }
  console.log('\n(non-strict mode: not failing. Pass --strict to gate on this.)');
}

main().catch((error) => {
  console.error('bench check failed:', error);
  process.exit(1);
});
