// CPU-bound scenario: compute fib(N) with a deliberately naive recursion to
// keep V8 busy on user code. Iterations are sized so the baseline wall time is
// in the 1.5-3s range — long enough for sampling to be representative, short
// enough to keep the bench runner cheap.

function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

const N = Number(process.env.BENCH_FIB_N ?? 37);
const ITERATIONS = Number(process.env.BENCH_FIB_ITERATIONS ?? 20);

let total = 0;
for (let i = 0; i < ITERATIONS; i++) {
  total += fib(N);
}
console.log(`fib total=${total}`);
