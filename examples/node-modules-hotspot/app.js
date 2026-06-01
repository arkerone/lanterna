// node_modules hotspot demo — a single dependency dominates the CPU profile.
// Run with `--kind cpu` and you should see:
//   - finding: node-modules-hotspot:heavy-stats
//   - the hot frame attributed to the `heavy-stats` package, called from `runBatch`
//
// `heavy-stats` is a vendored fixture under this folder's node_modules/ — no
// `npm install` is required.

import heavyStats from 'heavy-stats';

const { summarize } = heavyStats;
const RUN_MS = 120_000;

function buildSamples(n, seed) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(seed + i) * 1000;
  return out;
}

function runBatch(seed) {
  const samples = buildSamples(300, seed);
  return summarize(samples); // ~90k ops inside the dependency, per call
}

const start = Date.now();
let batches = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += runBatch(batches++);
}
console.log(`summarized ${batches} batches (${total})`);
