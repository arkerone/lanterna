// JSON on a hot path demo — per-request serialize + parse of large payloads.
// Run with `--kind cpu` and you should see:
//   - finding: json-on-hot-path:JSON.stringify (and/or :JSON.parse)
//   - hotspot in node:builtin JSON, correlated with `handleRequest`

const RUN_MS = 120_000;

// A realistically-sized API payload (an order with ~80 line items).
function buildOrder(i) {
  const items = [];
  for (let k = 0; k < 80; k++) {
    items.push({
      sku: `SKU-${i}-${k}`,
      name: `Item ${k}`,
      qty: (k % 7) + 1,
      price: (k * 13.37) % 100,
      tags: ['catalog', 'eu', `tier-${k % 5}`],
    });
  }
  return {
    id: i,
    customer: { id: i % 1000, name: `Customer ${i % 1000}`, email: `c${i % 1000}@example.com` },
    items,
    meta: {
      ts: Date.now(),
      region: 'eu-west-1',
      flags: { gift: i % 2 === 0, express: i % 3 === 0 },
    },
  };
}

// The classic "double JSON tax": serialize to send downstream, then parse the
// response back — both on the request path, every single request.
function handleRequest(order) {
  const wire = JSON.stringify(order);
  const echoed = JSON.parse(wire);
  return echoed.items.length + wire.length;
}

const start = Date.now();
let processed = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += handleRequest(buildOrder(processed++));
}
console.log(`processed ${processed} orders (${total})`);
