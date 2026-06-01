// Excessive GC demo — high allocation churn keeps the garbage collector busy.
// Run with `--kind cpu` and you should see:
//   - finding: excessive-gc (GC >= 10% of on-CPU time, or a long pause)
//   - elevated gc.totalPauseMs / gc.longestPauseMs in the report
//
// Per "request" we build and immediately drop a large graph of short-lived
// objects — classic per-request churn that floods the young generation.

const RUN_MS = 120_000;

function buildEphemeralGraph(n) {
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = { id: i, label: `node-${i}`, payload: { a: i, b: i * 2, c: `${i}` }, edges: [] };
  }
  for (let i = 0; i < n; i++) {
    nodes[i].edges.push(nodes[(i + 1) % n], nodes[(i + 7) % n]);
  }
  return nodes.length;
}

const start = Date.now();
let graphs = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += buildEphemeralGraph(20_000); // ~20k objects allocated then discarded
  graphs++;
}
console.log(`built ${graphs} graphs (${total})`);
