// Hot async context demo — most CPU runs under a single async chain root.
// Run with `--kind cpu,async` and you should see:
//   - finding: hot-async-context (one chain root accounts for >= 10% CPU)
//   - CPU samples attributed back to the `handleJob` async entry point
//
// All work flows through one async entry point; the CPU burned in its awaited
// continuations is attributed back to that chain root (the call site to fix).

function heavyCompute(seed) {
  let acc = 0;
  for (let i = 0; i < 2_000_000; i++) acc += Math.sqrt((seed + i) % 9973);
  return acc;
}

async function handleJob(id) {
  await Promise.resolve(); // enter async context
  const a = heavyCompute(id); // CPU inside the before/after run window
  await Promise.resolve();
  const b = heavyCompute(id + 1);
  return a + b;
}

let running = true;
(async () => {
  let id = 0;
  while (running) {
    await handleJob(id++);
  }
})();

setTimeout(() => {
  running = false;
  console.log('hot-async-context demo done');
}, 120_000);
