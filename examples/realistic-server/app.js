// Realistic server demo — a small HTTP API with several layered pathologies.
// Profile it under load (the CLI waits for readiness, then drives traffic):
//
//   lanterna run --kind cpu,memory \
//     --wait-for-url http://127.0.0.1:7070/health \
//     --workload "node examples/load/http-load.mjs http://127.0.0.1:7070/process 32 20000" \
//     -- node examples/realistic-server/app.js
//
// Under load you should reliably see `json-on-hot-path`, and typically also
// `cpu-hotspot`/`alloc-in-hot-path` on `enrich`, `excessive-gc`, and the
// occasional `blocking-io` from the periodic config check.

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 7070);
const SELF = fileURLToPath(import.meta.url);

// Build a verbose response by allocating per-item view models — CPU-hot and
// allocation-heavy, all in one user-code frame.
function enrich(order) {
  const lineItems = [];
  for (const item of order.items ?? []) {
    lineItems.push({
      sku: item.sku,
      label: `${item.name} x${item.qty}`,
      subtotal: item.qty * item.price,
      tags: (item.tags ?? []).map((t) => `#${t}`),
    });
  }
  return {
    id: order.id,
    lineItems,
    total: lineItems.reduce((sum, line) => sum + line.subtotal, 0),
  };
}

let requests = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    requests += 1;
    const order = body ? JSON.parse(body) : { items: [] }; // json-on-hot-path
    if (requests % 50 === 0) {
      // Occasional synchronous config check on the request path — blocking-io.
      try {
        readFileSync(SELF);
      } catch {
        /* ignore */
      }
    }
    const result = enrich(order); // cpu / alloc-in-hot-path
    const payload = JSON.stringify(result); // json-on-hot-path
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(payload);
  });
});

server.listen(PORT, () => {
  console.log(`realistic-server listening on http://127.0.0.1:${PORT}`);
});
