// FIXED event-loop-stall — build the catalog once, in memory, and reuse it.
// Verified to produce NO `blocking-io` / `event-loop-stall` finding (no
// synchronous read or parse on the hot path).

const RUN_MS = 120_000;

// Build the catalog once at startup (kept small so even this is cheap), then
// reuse the in-memory array on every tick instead of re-reading + re-parsing.
const catalog = [];
for (let i = 0; i < 5_000; i++) {
  catalog.push({ id: i, sku: `SKU-${i}`, name: `Product ${i}`, price: (i * 7.3) % 1000 });
}

let total = 0;
const interval = setInterval(() => {
  setImmediate(() => {
    total += 1;
  });
  total += catalog.length; // O(1) read of cached data — no blocking work
}, 50);

setTimeout(() => {
  clearInterval(interval);
  console.log(`accumulated ${total}`);
}, RUN_MS);
