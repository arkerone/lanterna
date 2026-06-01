// Event-loop stall demo — a large file is read AND parsed synchronously per tick.
// Run with `--kind cpu` and you should see:
//   - finding: blocking-io (readFileSync on a hot stack)
//   - finding: event-loop-stall (lag spikes correlated with the sync read+parse)
//   - eventLoop.histogram with elevated p99 / max
//
// `loadCatalog` synchronously reads a ~20 MB data file and JSON.parses it on
// every timer tick — both block the event loop, so other callbacks pile up.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Write a large "catalog" file once (stands in for a config / GeoIP / dataset).
const dir = mkdtempSync(join(tmpdir(), 'lanterna-stall-'));
const dataFile = join(dir, 'catalog.json');
const records = [];
for (let i = 0; i < 120_000; i++) {
  records.push({
    id: i,
    sku: `SKU-${i}`,
    name: `Product ${i}`,
    price: (i * 7.3) % 1000,
    description: 'x'.repeat(300),
  });
}
writeFileSync(dataFile, JSON.stringify(records));

function loadCatalog() {
  const raw = readFileSync(dataFile, 'utf8'); // blocking I/O
  return JSON.parse(raw).length; // CPU-heavy parse -> a long synchronous stall
}

let total = 0;
const interval = setInterval(() => {
  setImmediate(() => {
    total += 1; // light async work, starved while the sync read+parse runs
  });
  total += loadCatalog(); // blocking sync work on the hot path
}, 50);

setTimeout(() => {
  clearInterval(interval);
  console.log(`accumulated ${total}`);
}, 120_000);
