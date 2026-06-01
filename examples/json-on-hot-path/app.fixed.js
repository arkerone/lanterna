// FIXED json-on-hot-path — work with plain objects; no per-request JSON.
// Verified to produce NO `json-on-hot-path` finding (no JSON.parse/stringify on
// the hot path — the order is consumed as an object).

const RUN_MS = 120_000;

function buildOrder(i) {
  const items = [];
  for (let k = 0; k < 80; k++) {
    items.push({
      sku: `SKU-${i}-${k}`,
      name: `Item ${k}`,
      qty: (k % 7) + 1,
      price: (k * 13.37) % 100,
    });
  }
  return { id: i, items };
}

function handleRequest(order) {
  let total = 0;
  for (const item of order.items) total += item.qty * item.price; // no JSON
  return total;
}

const start = Date.now();
let processed = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += handleRequest(buildOrder(processed++));
}
console.log(`processed ${processed} orders (${total})`);
