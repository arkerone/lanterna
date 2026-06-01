// FIXED require-in-hot-path — load the plugin ONCE at startup, then reuse it.
// Verified to produce NO `require-in-hot-path` finding (no require() in the loop).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const RUN_MS = 120_000;

const dir = mkdtempSync(join(tmpdir(), 'lanterna-require-fixed-'));
const pluginPath = join(dir, 'pricing-plugin.js');
writeFileSync(
  pluginPath,
  `module.exports = function price(order) {
     let total = 0;
     for (const item of order.items) total += item.qty * item.price;
     return total * 1.2;
   };
  `,
);

const price = require(pluginPath); // loaded once, hoisted out of the loop

const start = Date.now();
let handled = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += price({ items: [{ qty: (handled % 5) + 1, price: 9.99 }] });
  handled++;
}
console.log(`priced ${handled} orders (${total})`);
