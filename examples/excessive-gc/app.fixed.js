// FIXED excessive-gc — reuse a pre-allocated pool of nodes (mutate in place).
// Verified to produce NO `excessive-gc` finding (near-zero allocation per
// iteration, so the collector stays idle).

const RUN_MS = 120_000;
const N = 20_000;

// Allocate the working set once, up front.
const pool = new Array(N);
for (let i = 0; i < N; i++) pool[i] = { id: 0, a: 0, b: 0 };

function processGraph(seed) {
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const node = pool[i];
    node.id = i;
    node.a = seed + i;
    node.b = i * 2;
    acc += node.a + node.b; // no allocation in the loop
  }
  return acc;
}

const start = Date.now();
let graphs = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  total += processGraph(graphs++);
}
console.log(`processed ${graphs} graphs (${total})`);
