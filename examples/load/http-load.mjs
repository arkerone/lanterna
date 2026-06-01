// Tiny dependency-free HTTP load generator (Node 22+, uses global fetch).
// Used by the realistic-server example as a `--workload`, but works standalone:
//
//   node examples/load/http-load.mjs <url> [concurrency] [durationMs]
//
// Fires POST requests with a JSON order body from N concurrent workers until
// the deadline, then prints how many requests it sent.

const url = process.argv[2];
const concurrency = Number(process.argv[3] ?? 32);
const durationMs = Number(process.argv[4] ?? 20_000);

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
let sent = 0;

async function worker() {
  while (Date.now() < deadline) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: makeOrder(sent++),
      });
    } catch {
      // Server still warming up or shutting down — keep going.
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`load done: ${sent} requests to ${url}`);
