// require() on a hot path demo — the module graph is re-resolved per request.
// Run with `--kind cpu` and you should see:
//   - finding: require-in-hot-path
//   - time spent in Module._load / require, attributed to `loadPlugin`
//
// Antipattern: a "plugin" is require()'d inside the request loop (with its cache
// entry busted) instead of being loaded once at boot. Every call pays the full
// resolution + compile cost. (We use createRequire because this file is ESM.)

import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const RUN_MS = 120_000;

// A small plugin written to a temp dir at startup.
const dir = mkdtempSync(join(tmpdir(), 'lanterna-require-'));
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

function loadPlugin() {
  // Bust the cache so Module._load re-resolves and recompiles every call.
  delete require.cache[require.resolve(pluginPath)];
  return require(pluginPath);
}

const start = Date.now();
let handled = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  const price = loadPlugin();
  total += price({ items: [{ qty: (handled % 5) + 1, price: 9.99 }] });
  handled++;
}
console.log(`priced ${handled} orders (${total})`);
