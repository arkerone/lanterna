// FIXED node-modules-hotspot — memoize the dependency result instead of
// recomputing it on every request. Verified to produce NO `node-modules-hotspot`
// finding (after warm-up the expensive `summarize` is never called again).

import heavyStats from 'heavy-stats';

const { summarize } = heavyStats;
const RUN_MS = 120_000;
const cache = new Map();

function buildSamples(n, seed) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(seed + i) * 1000;
  return out;
}

function runBatch(seed) {
  const key = seed % 16; // a small, stable set of inputs -> cache hits dominate
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = summarize(buildSamples(300, key));
  cache.set(key, result);
  return result;
}

const start = Date.now();
let batches = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += runBatch(batches++);
}
console.log(`summarized ${batches} batches (${total})`);
