// In-process self-profiling bench driver.
//
// Runs a fixed CPU workload either plain (`baseline`) or while profiling the
// current process via `profileInProcess()` (`profile`). It measures the wall
// time of the *workload only* (capture start/stop excluded), so the delta is the
// steady-state sampling perturbation — there is no spawn/startup cost here, which
// is the whole point of in-process mode.
//
// It also reports peak RSS (process.resourceUsage().maxRSS) — a true
// apples-to-apples memory-overhead number, since both modes run in the same
// process shape (no separate CLI/child to confuse the measurement).
//
// Usage: node bench/scenarios/in-process-workload.mjs <baseline|profile> [iterations]
// Prints: LANTERNA_INPROC_BENCH {"workloadMs":<n>,"maxRssBytes":<n>}

import { profileInProcess } from '@lanterna-profiler/core';

const mode = process.argv[2] ?? 'baseline';
const iterations = Number(process.argv[3] ?? process.env.BENCH_INPROC_ITERATIONS ?? 40);
const fibN = Number(process.env.BENCH_INPROC_FIB ?? 33);

function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

async function workload() {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    if (fib(fibN) < 0) throw new Error('unreachable');
    // Yield so the inspector message loop and the sampler can run.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return Number((process.hrtime.bigint() - start) / 1_000_000n);
}

let workloadMs;
if (mode === 'baseline') {
  workloadMs = await workload();
} else if (mode === 'profile') {
  const controller = new AbortController();
  const pending = profileInProcess({ signal: controller.signal });
  workloadMs = await workload();
  controller.abort();
  await pending;
} else {
  throw new Error(`unknown in-process mode: ${mode}`);
}

// Node normalizes maxRSS to kilobytes across platforms.
const maxRssBytes = process.resourceUsage().maxRSS * 1024;
process.stdout.write(`LANTERNA_INPROC_BENCH ${JSON.stringify({ workloadMs, maxRssBytes })}\n`);
