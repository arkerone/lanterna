// Dependency-free HTTP benchmark load generator for `bench/run.mjs`.
//
// Prints one machine-readable line:
//   LANTERNA_HTTP_BENCH {"requests":...,"p95Ms":...}

const url = process.argv[2];
const concurrency = Number(process.argv[3] ?? 16);
const durationMs = Number(process.argv[4] ?? 8_000);

if (!url) {
  console.error('usage: node http-load.mjs <url> [concurrency] [durationMs]');
  process.exit(1);
}

function makeOrder(i) {
  const items = [];
  for (let k = 0; k < 40; k++) {
    items.push({
      sku: `SKU-${i}-${k}`,
      name: `Item ${k}`,
      qty: (k % 5) + 1,
      price: (k * 7.5) % 50,
      tags: ['catalog', 'eu', `tier-${k % 4}`],
    });
  }
  return JSON.stringify({ id: i, items });
}

const deadline = Date.now() + durationMs;
const latencies = [];
let nextId = 0;
let errors = 0;

async function worker() {
  while (Date.now() < deadline) {
    const id = nextId++;
    const start = process.hrtime.bigint();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: makeOrder(id),
      });
      await response.arrayBuffer();
      if (!response.ok) errors++;
    } catch {
      errors++;
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      latencies.push(elapsedMs);
    }
  }
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

await Promise.all(Array.from({ length: concurrency }, worker));

const actualDurationMs = Math.max(1, durationMs);
const requests = latencies.length;
const metrics = {
  requests,
  errors,
  durationMs: actualDurationMs,
  requestsPerSec: (requests / actualDurationMs) * 1000,
  p50Ms: percentile(latencies, 50),
  p95Ms: percentile(latencies, 95),
  p99Ms: percentile(latencies, 99),
};

console.log(`LANTERNA_HTTP_BENCH ${JSON.stringify(metrics)}`);
