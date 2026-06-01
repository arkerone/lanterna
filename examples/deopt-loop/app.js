// Deopt loop demo — V8 repeatedly bails out of an optimized function.
// Run with `--deep --kind cpu` (deopt tracing needs --deep) and you should see:
//   - finding: deopt-loop:accumulate (count >= 3)
//
// `accumulate` gets JIT-compiled assuming a stable element kind, but we keep
// feeding it arrays whose element kind changes (smi -> double -> object-with-
// valueOf), forcing V8 to discard the optimized code and re-optimize again and
// again — a deoptimization loop.

const RUN_MS = 120_000;

function accumulate(values) {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]; // type-unstable: number, then double, then object
  }
  return sum;
}

function makeBatch(kind, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (kind === 0)
      out[i] = i; // packed smi
    else if (kind === 1)
      out[i] = i + 0.5; // packed double
    else out[i] = { valueOf: () => i }; // object with valueOf -> ToPrimitive
  }
  return out;
}

const start = Date.now();
let batches = 0;
let total = 0;
while (Date.now() - start < RUN_MS) {
  // Rotate the element kind every iteration to keep destabilizing accumulate().
  total += accumulate(makeBatch(batches % 3, 20_000));
  batches++;
}
console.log(`accumulated ${batches} batches (${total})`);
