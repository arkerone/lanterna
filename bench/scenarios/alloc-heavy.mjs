// Allocation-heavy scenario: churns short-lived objects so the GC has work to
// do. Useful for measuring the overhead of `--kind memory` (heap allocation
// profile + memoryUsage sampling).

const ITERATIONS = Number(process.env.BENCH_ALLOC_ITERATIONS ?? 25_000_000);
const PAYLOAD_SIZE = Number(process.env.BENCH_ALLOC_PAYLOAD_SIZE ?? 64);

let acc = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const arr = new Array(PAYLOAD_SIZE);
  for (let j = 0; j < PAYLOAD_SIZE; j++) arr[j] = (i + j) % 7;
  acc += arr.reduce((a, b) => a + b, 0);
}
console.log(`alloc total=${acc}`);
